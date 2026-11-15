// One question: built alone, it prints as plain Bun does.
const url = new URL("http://made.up/a"); let turns = 0; const server = Bun.serve({ hostname: "127.0.0.1", port: 0, development: false, fetch() { setImmediate(() => process.exit(0)); return turns++ ? new Response("made up").text() : new Promise(resolve => resolve(url)); } });
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
