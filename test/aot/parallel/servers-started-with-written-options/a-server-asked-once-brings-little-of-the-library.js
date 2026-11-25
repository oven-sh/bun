// The options are written at the call and name no application: the row of Bun.serve says all that native code does, and `Bun` stays in sight. The request comes from a shell, without a promise, and what is printed is in sight.
// STATISTIC: ImageFunctionsEmitted <= 30
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, self) {
    console.log("asked", self === server);
    process.exit(0);
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
