// The shape of a "/stream" route: what the encoder answers is known to nobody and goes to enqueue() by name.
// STATISTIC: ImageFunctionsEmitted <= 90
const encoder = new TextEncoder();
async function* lines() {
  yield "data: made\n\n";
  yield "data: up\n\n";
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/stream": () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            for await (const line of lines()) controller.enqueue(encoder.encode(line));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  },
});
const answered = await fetch(`http://127.0.0.1:${server.port}/stream`);
console.log(`${answered.headers.get("content-type")} ${JSON.stringify(await answered.text())}`);
server.stop(true);
