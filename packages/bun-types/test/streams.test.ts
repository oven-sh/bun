new ReadableStream({
  start(controller) {
    controller.enqueue("hello");
    controller.enqueue("world");
    controller.close();
  },
});

// this will have type errors when lib.dom.d.ts is present
// afaik this isn't fixable
new ReadableStream({
  type: "direct",
  pull(controller) {
    // eslint-disable-next-line
    controller.write("hello");
    // eslint-disable-next-line
    controller.write("world");
    controller.close();
  },
  cancel() {
    // called if stream.cancel() is called
  },
});
