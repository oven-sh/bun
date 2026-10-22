const strategy = {
  highWaterMark: 4,
  size(chunk) {
    console.log(typeof chunk, chunk.length);
    return chunk.length;
  },
};
const stream = new ReadableStream(
  {
    start(controller) {
      controller.enqueue("ab");
      console.log(controller.desiredSize);
      controller.close();
    },
  },
  strategy,
);
console.log((await stream.getReader().read()).value);
