const stream = new WritableStream({
  write(chunk, controller) {
    console.log("write", typeof chunk, chunk.size + 1, typeof controller);
  },
  close() {
    console.log("close");
  },
});
const writer = stream.getWriter();
await writer.write({ size: 1.5 });
await writer.close();
