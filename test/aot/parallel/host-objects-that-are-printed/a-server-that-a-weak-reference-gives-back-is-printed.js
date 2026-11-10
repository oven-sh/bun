// Exit code: 3
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, development: false, fetch(request) { return new Response("made up"); } });
console.error(new WeakRef(server).deref());
process.exit(3);
