// The same for zero, under a key that is made when the program runs.
(function () {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") });
  const map = new Map([[1, server]]);
  globalThis.held = map;
  globalThis.held[["con", "structor"].join("")] = 0;
  try {
    queueMicrotask(map);
  } catch (error) {
    console.log("refused");
  }
  process.exit(0);
})();
