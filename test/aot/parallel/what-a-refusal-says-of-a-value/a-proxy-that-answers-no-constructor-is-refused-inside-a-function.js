// A Proxy answers undefined for every name.
(function () { const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") }); try { queueMicrotask(new Proxy([server], { get: () => undefined })); } catch (error) {} process.exit(0); })();
