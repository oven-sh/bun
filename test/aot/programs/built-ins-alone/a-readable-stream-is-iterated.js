const stream = new ReadableStream({
  start(controller) {
    controller.enqueue({ size: 1.5 });
    controller.enqueue("two");
    controller.close();
  },
});
for await (const chunk of stream) console.log(typeof chunk, chunk);
