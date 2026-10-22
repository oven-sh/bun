const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
console.log(stream.locked);
const reader = stream.getReader();
console.log(stream.locked);
reader.releaseLock();
console.log(stream.locked);
