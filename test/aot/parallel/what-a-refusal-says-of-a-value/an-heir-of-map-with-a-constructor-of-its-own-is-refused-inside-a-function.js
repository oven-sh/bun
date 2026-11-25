// An instance of a class of the program below Map is no plain object.
(function () { class Held extends Map {} const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") }); const held = new Held([[1, server]]); held.constructor = undefined; try { queueMicrotask(held); } catch (error) {} process.exit(0); })();
