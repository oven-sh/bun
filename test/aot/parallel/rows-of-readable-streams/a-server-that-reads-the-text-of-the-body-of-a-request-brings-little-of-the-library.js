// text() of the stream itself.
// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    return new Response(await request.body.text());
  },
});
const answered = await server.fetch(new Request("http://made.up/", { method: "POST", body: "made up" }));
console.log(`${await answered.text()}`);
server.stop(true);
