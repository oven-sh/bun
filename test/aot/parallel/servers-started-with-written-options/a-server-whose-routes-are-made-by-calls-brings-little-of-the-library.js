// The same for what Response.json() and Response.redirect() make.
// STATISTIC: ImageFunctionsEmitted <= 40
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: { "/made-up": Response.json({ made: "up" }), "/away": Response.redirect("/made-up") },
  fetch() {
    setImmediate(() => {
      console.log("asked elsewhere");
      process.exit(0);
    });
    return new Response("elsewhere");
  },
});
Bun.spawnSync([
  "bash",
  "-c",
  `for path in /made-up /away /elsewhere; do exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf "GET $path HTTP/1.0\\r\\n\\r\\n" >&3; done`,
]);
