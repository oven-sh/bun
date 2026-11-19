// The same out of the handler of a server.
// Exit code: 3
const params = new URLSearchParams("made=up");
params.toJSON = () => new URL("http://made.up/");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  development: false,
  fetch() {
    setImmediate(() => process.exit(3));
    throw params;
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
