const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
const result = Bun.readableStreamToText(first);
const settled = await result;
console.log(typeof settled, settled.length, settled, first instanceof ReadableStream, Object.keys(first).join());
