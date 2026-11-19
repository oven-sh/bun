// A constructor that is false counts as none: the map is printed whole, with the server that it holds.
(function () {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
  const map = new Map([[1, server]]);
  globalThis.held = map;
  globalThis.held.constructor = false;
  try {
    queueMicrotask(map);
  } catch (error) {
    console.log("refused");
  }
  process.exit(0);
})();
