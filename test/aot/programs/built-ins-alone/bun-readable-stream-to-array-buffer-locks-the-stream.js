const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
console.log(stream.locked);
const waiting = Bun.readableStreamToArrayBuffer(stream);
console.log(stream.locked, typeof (await waiting));
