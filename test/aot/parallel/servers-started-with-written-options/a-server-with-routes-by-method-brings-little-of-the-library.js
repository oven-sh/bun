// A route by method lies two literals below the options.
// STATISTIC: ImageFunctionsEmitted <= 30
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/made-up": {
      GET: () => new Response("got"),
      POST(request) {
        setImmediate(() => {
          console.log(`posted ${request.method}`);
          process.exit(0);
        });
        return new Response("posted");
      },
    },
    "/never": false,
  },
  fetch: () => new Response("no", { status: 404 }),
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'POST /made-up HTTP/1.0\\r\\nContent-Length: 0\\r\\n\\r\\n' >&3`]);
