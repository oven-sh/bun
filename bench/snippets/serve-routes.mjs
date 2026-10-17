// Measures `Bun.serve({ routes })`, `server.reload()` and one request as a function of how many
// routes are registered. Run with a release build:
//
//   bun bench/snippets/serve-routes.mjs
//   bun bench/snippets/serve-routes.mjs 1000 8000
//
// Each time is the fastest of a few runs.

const counts = process.argv
  .slice(2)
  .map(Number)
  .filter(n => Number.isFinite(n) && n > 0);
const ROUTE_COUNTS = counts.length ? counts : [10, 100, 1_000, 4_000, 8_000];
const REPEAT = 5;
const REQUESTS = 2_000;

const shapes = {
  // One handler for every method.
  "fn": () => () => new Response("ok"),
  // One handler for one method.
  "{ GET: fn }": () => ({ GET: () => new Response("ok") }),
  // A static response for every method.
  "Response": () => new Response("ok"),
};

function makeRoutes(total, make) {
  const routes = Object.create(null);
  for (let i = 0; i < total; i++) {
    routes[`/${i}`] = make();
  }
  return routes;
}

function fastest(fn) {
  let best = Infinity;
  for (let i = 0; i < REPEAT; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

async function requestMicroseconds(url) {
  let best = Infinity;
  for (let i = 0; i < REPEAT; i++) {
    const start = performance.now();
    for (let j = 0; j < REQUESTS; j++) {
      await (await fetch(url)).arrayBuffer();
    }
    best = Math.min(best, performance.now() - start);
  }
  return (best * 1000) / REQUESTS;
}

const rows = [];
for (const [shape, make] of Object.entries(shapes)) {
  for (const total of ROUTE_COUNTS) {
    const options = {
      port: 0,
      routes: makeRoutes(total, make),
      fetch: () => new Response("not found", { status: 404 }),
    };
    const serve = fastest(() => Bun.serve(options).stop(true));
    const server = Bun.serve(options);
    const reload = fastest(() => server.reload(options));
    const first = await requestMicroseconds(`http://127.0.0.1:${server.port}/0`);
    const last = await requestMicroseconds(`http://127.0.0.1:${server.port}/${total - 1}`);
    server.stop(true);
    rows.push({ shape, routes: total, serve, reload, first, last });
    console.log(
      `${shape.padEnd(11)} ${total.toLocaleString().padStart(7)} routes  serve ${serve.toFixed(2).padStart(9)} ms  reload ${reload.toFixed(2).padStart(9)} ms  ` +
        `request for the first route ${first.toFixed(1).padStart(6)} us  for the last ${last.toFixed(1).padStart(6)} us`,
    );
  }
}

// Machine-readable line for tooling.
console.log("\nJSON: " + JSON.stringify(rows));
