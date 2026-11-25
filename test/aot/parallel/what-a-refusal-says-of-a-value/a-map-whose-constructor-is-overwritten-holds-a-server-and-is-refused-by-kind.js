// A Map with an own `constructor` that is undefined keeps its prototype: the formatter prints what it holds.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
const map = new Map([[1, server]]);
map.constructor = undefined;
try {
  queueMicrotask(map);
} catch (error) {
  console.log(`${error.code} ${error.message.includes("pendingRequests")} ${error.message.includes("URL")}`);
}
process.exit(0);
