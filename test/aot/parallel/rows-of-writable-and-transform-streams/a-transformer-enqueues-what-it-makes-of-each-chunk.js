const source = new ReadableStream({
  start(controller) {
    controller.enqueue("made");
    controller.enqueue("up");
    controller.close();
  },
});
const shouted = source.pipeThrough(
  new TransformStream({
    start(controller) {
      controller.enqueue(`${controller.desiredSize}`);
    },
    transform(chunk, controller) {
      controller.enqueue(chunk.toUpperCase());
    },
    flush(controller) {
      controller.enqueue("!");
      controller.terminate();
    },
  }),
);
let text = "";
for await (const chunk of shouted) text += `${chunk} `;
console.log(`${text}`);
