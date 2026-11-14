// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    let length = 0;
    await request.body.pipeTo(
      new WritableStream({
        write(chunk) {
          length += chunk.length;
        },
      }),
    );
    return new Response(`${length}`);
  },
});
const answered = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST", body: "made up" });
console.log(`${await answered.text()}`);
server.stop(true);
