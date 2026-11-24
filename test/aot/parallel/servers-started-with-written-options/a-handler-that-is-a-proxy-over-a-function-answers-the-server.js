// A Proxy over a function can be called: it is a handler.
// Exit code: 3
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  development: false,
  fetch: new Proxy(() => {
    setImmediate(() => process.exit(3));
    return server;
  }, {}),
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
