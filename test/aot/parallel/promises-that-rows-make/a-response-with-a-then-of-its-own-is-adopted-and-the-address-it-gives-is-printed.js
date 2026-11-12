// One question: built alone, it prints as plain Bun does.
const url = new URL("http://made.up/a"); const answer = new Response("made up"); answer.then = resolve => resolve(url); const server = Bun.serve({ hostname: "127.0.0.1", port: 0, development: false, fetch() { setImmediate(() => process.exit(0)); return Promise.resolve(answer); } });
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
