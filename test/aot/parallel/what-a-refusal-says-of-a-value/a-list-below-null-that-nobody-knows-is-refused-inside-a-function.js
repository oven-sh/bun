// The list comes back out of the global object.
(function () { const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") }); globalThis.held = Object.setPrototypeOf([server], null); try { queueMicrotask(globalThis.held); } catch (error) {} process.exit(0); })();
