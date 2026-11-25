// getReader() is called with nothing between the parentheses: the row that prints a wrong `mode` has nothing to print.
// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const reader = request.body.getReader();
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
    }
    reader.releaseLock();
    return new Response(`${length} ${request.body.locked}`);
  },
});
const answered = await server.fetch(new Request("http://made.up/", { method: "POST", body: "made up" }));
console.log(`${await answered.text()}`);
server.stop(true);
