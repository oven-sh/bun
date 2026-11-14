// The stream goes from the request into the response: native code asks it for Symbol.asyncIterator and nobody prints it.
// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return new Response(request.body);
  },
});
const answered = await server.fetch(new Request("http://made.up/", { method: "POST", body: "made up" }));
console.log(`${await answered.text()}`);
server.stop(true);
