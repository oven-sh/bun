// An own `constructor` that is undefined hides the one above.
(function () { const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") }); const map = new Map([[1, server]]); map.constructor = undefined; try { queueMicrotask(map); } catch (error) {} process.exit(0); })();
