const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
const result = Bun.readableStreamToBytes(first);
const settled = await result;
console.log(settled instanceof Uint8Array, settled.length, typeof settled[0], settled[0] + 1);
console.log(typeof settled[1], settled[1] + 1, first instanceof ReadableStream, Object.keys(first).join());
