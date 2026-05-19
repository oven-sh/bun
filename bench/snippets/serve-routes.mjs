// Measures the cost of `Bun.serve({ routes })` as a function of how many routes
// are registered. Run with a release build, e.g.:
//
//   bun-release bench/snippets/serve-routes.mjs
//   bun-release bench/snippets/serve-routes.mjs 1000 5000 10000 20000 40000 100000
//
// Each route count is timed a few times and the fastest run is reported.

const counts = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n) && n > 0);
const ROUTE_COUNTS = counts.length ? counts : [1_000, 5_000, 10_000, 20_000, 40_000, 100_000];
const REPEAT = 5;

function makeRoutes(total) {
  const routes = Object.create(null);
  const handler = { GET: () => new Response("ok") };
  for (let i = 0; i < total; i++) {
    routes[`/${i}`] = handler;
  }
  return routes;
}

function timeServe(routes) {
  const t = performance.now();
  const server = Bun.serve({ port: 0, routes });
  const elapsed = performance.now() - t;
  server.stop(true);
  return elapsed;
}

const rows = [];
for (const total of ROUTE_COUNTS) {
  const routes = makeRoutes(total);
  // Warmup once, then take the best of REPEAT.
  timeServe(routes);
  let best = Infinity;
  for (let i = 0; i < REPEAT; i++) {
    best = Math.min(best, timeServe(routes));
  }
  rows.push({ routes: total, ms: best });
  console.log(`${total.toLocaleString().padStart(9)} routes  ->  ${best.toFixed(2).padStart(10)} ms`);
}

// Machine-readable line for tooling.
console.log("\nJSON: " + JSON.stringify(rows));
