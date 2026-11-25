// The shape of a stream of events: the source closes when the request is aborted.
// STATISTIC: ImageFunctionsEmitted <= 90
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return new Response(
      new ReadableStream({
        start(controller) {
          request.signal.addEventListener("abort", () => controller.close(), { once: true });
          controller.enqueue("made up");
          controller.close();
        },
      }),
    );
  },
});
const answered = await fetch(`http://127.0.0.1:${server.port}/`);
console.log(`${await answered.text()}`);
server.stop(true);
