// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return new Response(request.body.pipeThrough(new CompressionStream("gzip")).pipeThrough(new DecompressionStream("gzip")));
  },
});
const answered = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST", body: "made up" });
console.log(`${await answered.text()}`);
server.stop(true);
