// The first options have no `error`. reload() brings one, and what the new `fetch` throws reaches it.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    return new Response("first");
  },
});
server.reload({
  fetch() {
    atob("*");
  },
  error(error) {
    console.log(error.name, error.code, error instanceof Error);
    process.exit(0);
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
