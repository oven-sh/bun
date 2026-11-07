// The host prints an answer that is no Response, with what lies on its prototypes.
// Exit code: 3
function Place() {
  this.label = 1;
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  development: false,
  fetch() {
    setImmediate(() => process.exit(3));
    return new Place();
  },
});
Place.prototype.held = server;
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
