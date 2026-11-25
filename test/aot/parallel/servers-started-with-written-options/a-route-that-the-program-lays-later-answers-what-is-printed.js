// The literal of the routes has a second user: what lies there when the server starts is nobody's to say.
// Exit code: 3
const routes = { "/made-up": () => new Response("first") };
routes["/made-up"] = (request, self) => {
  setImmediate(() => process.exit(3));
  return self;
};
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, development: false, routes });
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
