// The shape of a streaming helper: the readable end is the body, a writer fills the writable end.
// STATISTIC: ImageFunctionsEmitted <= 90
const encoder = new TextEncoder();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    writer
      .write(encoder.encode("made "))
      .then(() => writer.write(encoder.encode("up")))
      .then(() => writer.close());
    return new Response(readable);
  },
});
const answered = await fetch(`http://127.0.0.1:${server.port}/`);
console.log(`${await answered.text()}`);
server.stop(true);
