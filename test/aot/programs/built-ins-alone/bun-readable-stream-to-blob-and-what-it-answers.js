const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
const result = Bun.readableStreamToBlob(first);
const settled = await result;
console.log(settled instanceof Blob, Object.keys(settled).join(), first instanceof ReadableStream, Object.keys(first).join());
