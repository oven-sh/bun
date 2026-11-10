// Exit code: 3
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, development: false, fetch(request) { return new Response("made up"); } });
try {
  if (process.argv.length < 9) throw server;
} catch (caught) {
  console.error(caught);
}
process.exit(3);
