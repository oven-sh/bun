// A Response that is made where the route is written is sent as it is: nobody calls it, and nobody prints it.
// STATISTIC: ImageFunctionsEmitted <= 30
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: { "/made-up": new Response("made up") },
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
  `for path in /made-up /elsewhere; do exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf "GET $path HTTP/1.0\\r\\n\\r\\n" >&3; done`,
]);
