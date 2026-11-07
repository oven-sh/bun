// The route is written in a literal below the options: what it answers is in sight, and it is a Response.
// STATISTIC: ImageFunctionsEmitted <= 30
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/made-up": request => {
      setImmediate(() => {
        console.log(`asked ${request.method}`);
        process.exit(0);
      });
      return new Response("made up");
    },
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
