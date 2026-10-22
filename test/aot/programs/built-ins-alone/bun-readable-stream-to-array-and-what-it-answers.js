const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
const result = Bun.readableStreamToArray(first);
const settled = await result;
console.log(Array.isArray(settled), settled.length, settled[0] instanceof Uint8Array, settled[0].length);
console.log(typeof settled[0][0], settled[0][0] + 1, typeof settled[0][1], settled[0][1] + 1, first instanceof ReadableStream);
console.log(Object.keys(first).join());
