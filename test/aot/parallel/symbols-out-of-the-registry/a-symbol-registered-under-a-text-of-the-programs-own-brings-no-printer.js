// The registry gives the symbol under the written text, which is not the one that the printer looks under.
// STATISTIC: ImageFunctionsEmitted <= 30
const mark = Symbol.for("made.up.mark");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    setImmediate(() => {
      console.log(`${typeof mark} ${Symbol.keyFor(mark)}`);
      process.exit(0);
    });
    return new Response("made up");
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
