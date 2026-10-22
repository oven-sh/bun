const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
const result = Bun.readableStreamToArrayBuffer(first);
const settled = await result;
console.log(settled instanceof ArrayBuffer, settled.byteLength, first instanceof ReadableStream, Object.keys(first).join());
