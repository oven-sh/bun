// The Response has a second user, which lays the handler.
// Exit code: 3
const route = new Response("never");
route.GET = () => {
  setImmediate(() => process.exit(3));
  return server;
};
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, development: false, routes: { "/made-up": route } });
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
