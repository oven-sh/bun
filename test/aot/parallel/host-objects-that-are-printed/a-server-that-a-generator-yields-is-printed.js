// Exit code: 3
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, development: false, fetch(request) { return new Response("made up"); } });
function* all() {
  yield server;
}
for (const value of all()) console.error(value);
process.exit(3);
