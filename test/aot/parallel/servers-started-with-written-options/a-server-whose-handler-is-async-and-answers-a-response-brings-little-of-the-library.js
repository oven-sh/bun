// The promise of an async handler holds a Response, which the host wants: nothing is walked.
// STATISTIC: ImageFunctionsEmitted <= 60
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    setImmediate(() => {
      console.log("answered");
      process.exit(0);
    });
    return new Response("made up");
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
