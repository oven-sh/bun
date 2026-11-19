// The server asks every route that is an object for the methods before it asks whether it is a Response. The handler answers the server, and the host prints that.
// Exit code: 3
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  development: false,
  routes: {
    "/made-up": Object.assign(new Response("never"), {
      GET() {
        setImmediate(() => process.exit(3));
        return server;
      },
    }),
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
