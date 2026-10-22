const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
const result = Bun.readableStreamToJSON(first);
const settled = await result;
console.log(Array.isArray(settled), settled.length, typeof settled[0], settled[0] + 1, first instanceof ReadableStream);
console.log(Object.keys(first).join());
