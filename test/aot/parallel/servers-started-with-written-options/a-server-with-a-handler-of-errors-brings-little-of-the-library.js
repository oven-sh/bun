// `error` is handed what `fetch` threw, and `this` is the server: the row says so, and no object of an unknown class comes to be for it. The request comes from a shell, without a promise.
// STATISTIC: ImageFunctionsEmitted <= 30
class Refusal {
  constructor(why) {
    this.why = why;
  }
  describe() {
    return "refused: " + this.why;
  }
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    throw new Refusal("not today");
  },
  error(error) {
    console.log(error instanceof Refusal, `${error.describe()}`, this === server);
    process.exit(0);
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${server.port}; printf 'GET /made-up HTTP/1.0\\r\\n\\r\\n' >&3`]);
