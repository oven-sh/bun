let pulls = 0;
const stream = new ReadableStream({
  start(controller) {
    console.log("start", typeof controller.enqueue, this === undefined);
  },
  pull(controller) {
    pulls++;
    console.log("pull", pulls);
    controller.enqueue({ size: pulls + 0.5 });
  },
  cancel(reason) {
    console.log("cancel", typeof reason, reason.length);
  },
});
const reader = stream.getReader();
console.log((await reader.read()).value.size + 1);
await reader.cancel("stop");
