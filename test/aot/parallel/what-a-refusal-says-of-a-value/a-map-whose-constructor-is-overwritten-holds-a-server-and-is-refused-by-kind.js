// A Map with an own `constructor` that is undefined keeps its prototype, which names it.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
const map = new Map([[1, server]]);
map.constructor = undefined;
try {
  queueMicrotask(map);
} catch (error) {
  console.log(`${error.code} ${error.message}`);
}
process.exit(0);
