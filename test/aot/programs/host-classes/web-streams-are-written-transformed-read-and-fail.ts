const chunks: string[] = [];
const writable = new WritableStream<string>({
  write(chunk, controller) {
    chunks.push(chunk);
    if (chunk === "stop") controller.error(new Error("stopped"));
  },
});
const writer = writable.getWriter();
console.log(writable.locked, writer.desiredSize);
await writer.ready;
await writer.write("a");
await writer.write("b");
console.log(await writer.write("stop").then(() => "written", error => error.message));
console.log(await writer.closed.then(() => "closed", error => error.message), chunks.join());
writer.releaseLock();
console.log(writable.locked);
const transform = new TransformStream<string, string>({
  transform(chunk, controller) {
    controller.enqueue(chunk.toUpperCase());
    if (chunk === "z") controller.terminate();
  },
});
const input = transform.writable.getWriter();
const output = transform.readable.getReader();
input.write("x");
input.write("z");
console.log((await output.read()).value, (await output.read()).value, (await output.read()).done);
console.log(await (output.read as Function).call({}).then(() => "read", (error: Error) => error.name));
try {
  (ReadableStream.prototype.getReader as Function).call({});
} catch (error) {
  console.log((error as Error).name);
}
const failing = new ReadableStream<number>({
  pull(controller) {
    console.log(controller.desiredSize);
    controller.error(new RangeError("no more"));
  },
});
const failingReader = failing.getReader();
console.log(await failingReader.read().then(() => "read", error => error.message));
console.log(await failingReader.cancel("x").then(() => "cancelled", error => error.message));
