// Nobody adds a listener: the warning of addEventListener() stays out, and the standard streams with it.
// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return new Response(`${request.signal.aborted}`);
  },
});
const answered = await server.fetch(new Request("http://made.up/"));
console.log(`${await answered.text()}`);
server.stop(true);
