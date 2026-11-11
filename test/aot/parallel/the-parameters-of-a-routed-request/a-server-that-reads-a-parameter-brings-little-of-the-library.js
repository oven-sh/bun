// The host makes an object of strings and nothing else for `params` of a routed request.
// STATISTIC: ImageFunctionsEmitted <= 100
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/made/:name": request => {
      console.log(`${request.params.name} ${request.params.other}`);
      process.exit(0);
    },
  },
});
Bun.spawnSync([
  "bash",
  "-c",
  `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made/up HTTP/1.0\\r\\n\\r\\n' >&3`,
]);
