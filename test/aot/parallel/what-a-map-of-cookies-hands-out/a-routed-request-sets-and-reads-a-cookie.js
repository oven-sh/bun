// The host makes a CookieMap and nothing else for `cookies` of a routed request.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/made-up": request => {
      request.cookies.set("a", "b");
      console.log(`${request.cookies.get("a")} ${request.cookies.has("c")}`);
      process.exit(0);
    },
  },
});
Bun.spawnSync([
  "bash",
  "-c",
  `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`,
]);
