const stream = new TransformStream({
  transform(chunk, controller) {
    controller.enqueue(chunk * 2);
  },
  flush(controller) {
    controller.enqueue("end");
  },
});
const writer = stream.writable.getWriter();
writer.write(1.5);
writer.close();
for await (const chunk of stream.readable) console.log(typeof chunk, chunk);
