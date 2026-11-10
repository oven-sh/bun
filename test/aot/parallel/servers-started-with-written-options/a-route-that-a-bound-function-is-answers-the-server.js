// A call that hands back a function makes a handler.
// Exit code: 3
function answer() {
  setImmediate(() => process.exit(3));
  return server;
}
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, development: false, routes: { "/made-up": answer.bind(null) } });
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
