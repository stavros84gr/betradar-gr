exports.handler = async function (event, context) {
  const API_KEY = process.env.ODDS_API_KEY;

  // Πρωταθλήματα: Ελλάδα, Αγγλία, Ισπανία, Ιταλία, Γερμανία
  const leagues = [
    { key: 'soccer_greece_super_league', name: 'Super League', region: 'greece', flag: '🇬🇷' },
    { key: 'soccer_epl', name: 'Premier League', region: 'europe', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
    { key: 'soccer_spain_la_liga', name: 'La Liga', region: 'europe', flag: '🇪🇸' },
    { key: 'soccer_italy_serie_a', name: 'Serie A', region: 'europe', flag: '🇮🇹' },
    { key: 'soccer_germany_bundesliga', name: 'Bundesliga', region: 'europe', flag: '🇩🇪' }
  ];

  if (!API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing ODDS_API_KEY in Netlify Environment Variables' })
    };
  }

  try {
    const now = new Date();
    const maxFuture = new Date(now.getTime() + 48 * 60 * 60 * 1000); // Επόμενες 48 ώρες
    let allMatches = [];

    // Κλήση στο The Odds API για κάθε ενεργό πρωτάθλημα
    const requests = leagues.map(async (league) => {
      const url = `https://api.the-odds-api.com/v4/sports/${league.key}/odds/?apiKey=${API_KEY}&regions=eu&markets=h2h,totals&oddsFormat=decimal`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();

      return data
        .filter((game) => {
          const kickoff = new Date(game.commence_time);
          // Κρατάμε ΜΟΝΟ παιχνίδια που δεν έχουν ξεκινήσει ακόμα (μέσα στις επόμενες 48 ώρες)
          return kickoff > now && kickoff <= maxFuture;
        })
        .map((game, idx) => {
          const bookmaker = game.bookmakers?.[0];
          const h2h = bookmaker?.markets?.find((m) => m.key === 'h2h')?.outcomes || [];
          const totals = bookmaker?.markets?.find((m) => m.key === 'totals')?.outcomes || [];

          const homeOdd = h2h.find((o) => o.name === game.home_team)?.price || 2.10;
          const awayOdd = h2h.find((o) => o.name === game.away_team)?.price || 3.20;
          const drawOdd = h2h.find((o) => o.name === 'Draw')?.price || 3.30;
          const overOdd = totals.find((o) => o.name === 'Over')?.price || 1.85;
          const underOdd = totals.find((o) => o.name === 'Under')?.price || 1.95;

          // Αυτόματη επιλογή προγνωστικού (Value Pick)
          let pick = '1';
          let pickLabel = `1 (${game.home_team})`;
          let pickOdd = homeOdd;
          let category = '1x2';

          if (homeOdd <= 1.75) {
            pick = '1';
            pickLabel = `1 (${game.home_team})`;
            pickOdd = homeOdd;
            category = '1x2';
          } else if (awayOdd <= 1.80) {
            pick = '2';
            pickLabel = `2 (${game.away_team})`;
            pickOdd = awayOdd;
            category = '1x2';
          } else if (overOdd <= 1.90) {
            pick = 'Over 2.5';
            pickLabel = 'Over 2.5 Γκολ';
            pickOdd = overOdd;
            category = 'goals';
          } else {
            pick = '1X & Over 1.5';
            pickLabel = '1X & Over 1.5';
            pickOdd = Number((homeOdd * 0.78).toFixed(2));
            category = 'value';
          }

          // Υπολογισμός πιθανότητας/confidence από τις αποδόσεις
          const confidence = Math.min(88, Math.max(58, Math.round((1 / pickOdd) * 100 + 14)));

          return {
            id: game.id,
            region: league.region,
            league: league.name,
            flag: league.flag,
            home: game.home_team,
            away: game.away_team,
            kickoffISO: game.commence_time,
            category: category,
            pick: pick,
            pickLabel: pickLabel,
            odd: Number(pickOdd.toFixed(2)),
            confidence: confidence,
            source: bookmaker?.title || 'Live Odds Feed',
            analysis: `Ζωντανή ανάλυση αποδόσεων (${bookmaker?.title || 'EU Market'}): Άσος ${homeOdd} | Χ ${drawOdd} | Διπλό ${awayOdd}.`,
            markets: {
              home: homeOdd,
              draw: drawOdd,
              away: awayOdd,
              over25: overOdd,
              under25: underOdd
            }
          };
        });
    });

    const results = await Promise.all(requests);
    allMatches = results.flat().sort((a, b) => new Date(a.kickoffISO) - new Date(b.kickoffISO));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // Cache 5 λεπτών για εξοικονόμηση API credits
      },
      body: JSON.stringify({
        updatedAt: now.toISOString(),
        count: allMatches.length,
        matches: allMatches
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
