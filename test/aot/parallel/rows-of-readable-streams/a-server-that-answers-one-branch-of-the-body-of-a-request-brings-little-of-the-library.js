// tee() answers a list of two streams.
// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const [left, right] = request.body.tee();
    return new Response((await right.text()).length + (await left.text()));
  },
});
const answered = await server.fetch(new Request("http://made.up/", { method: "POST", body: "made up" }));
console.log(`${await answered.text()}`);
server.stop(true);
