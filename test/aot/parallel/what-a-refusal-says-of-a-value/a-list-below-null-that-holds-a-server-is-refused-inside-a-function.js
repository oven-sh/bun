// Nobody reads the message: the refusal prints the list all the same.
(function () { const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("made up") }); try { queueMicrotask(Object.setPrototypeOf([server], null)); } catch (error) {} process.exit(0); })();
