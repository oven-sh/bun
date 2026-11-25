// The address is made in the handler and never leaves it: what is caught cannot be it.
// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    try {
      return new Response(`${new URL(request.url).pathname.length + (await request.json()).a}`);
    } catch (error) {
      console.log(error.message);
      return new Response("bad", { status: 400 });
    }
  },
});
const answered = await fetch(`http://127.0.0.1:${server.port}/made/up`, { method: "POST", body: "{" });
console.log(`${answered.status} ${await answered.text()}`);
server.stop(true);
