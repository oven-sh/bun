// Nobody prints the address: the method that the printer would call on it stays out, and util.inspect with it.
// STATISTIC: ImageFunctionsEmitted <= 40
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    setImmediate(() => {
      console.log(`${url.pathname} ${url.searchParams.get("a")}`);
      process.exit(0);
    });
    return new Response(url.pathname);
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up?a=1 HTTP/1.1\\r\\nHost: made.up\\r\\n\\r\\n' >&3`]);
