// The host prints what a route answers where that is no Response, and the printer reads the getters of the server.
// Exit code: 3
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  development: false,
  routes: {
    "/made-up": (request, self) => {
      setImmediate(() => process.exit(3));
      return self;
    },
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
