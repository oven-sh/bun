// One question: built alone, it prints as plain Bun does.
const url = new URL("http://made.up/a"); const server = Bun.serve({ hostname: "127.0.0.1", port: 0, development: false, fetch() { setImmediate(() => globalThis.settle(url)); setTimeout(() => process.exit(0), 50); return new Promise(resolve => { globalThis.settle = resolve; }); } });
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
