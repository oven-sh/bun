const heard = [];
const stream = new WritableStream(
  {
    start(controller) {
      controller.signal.onabort = () => heard.push(`signal ${controller.signal.aborted}`);
    },
    write(chunk) {
      heard.push(`write ${chunk}`);
    },
    abort(reason) {
      heard.push(`abort ${reason}`);
    },
  },
  { highWaterMark: 2 },
);
const writer = stream.getWriter();
console.log(`${stream.locked} ${writer.desiredSize}`);
await writer.ready;
await writer.write("made up");
writer.closed.catch(reason => heard.push(`closed ${reason}`));
await writer.abort("enough");
writer.releaseLock();
await new Promise(resolve => setTimeout(resolve, 1));
console.log(`${stream.locked} ${heard.join(" | ")}`);
let text = "no refusal";
try {
  writer.desiredSize;
} catch (error) {
  text = `${error.name} ${error.code}`;
}
console.log(`${text}`);
