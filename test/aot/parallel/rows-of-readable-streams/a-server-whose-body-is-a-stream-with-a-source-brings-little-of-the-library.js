// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue("made ");
          controller.enqueue("up");
          controller.close();
        },
      }),
    );
  },
});
const answered = await server.fetch(new Request("http://made.up/"));
console.log(`${await answered.text()}`);
server.stop(true);
