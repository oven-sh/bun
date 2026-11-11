// Flags: --aot-testing=CheckWalkAtRunTime
// The short roads of node:stream stand behind questions that the library asks of its own objects and of the built-in ones: whether a state answers under every name as it was born,
// whether a controller and its signal are as built. A question that says no is no fault: the long road answers the same, and no other test sees it.
// Two hundred pipelines of streams that nobody has touched: the floor stands close under what they count. Whoever takes a yes away finds this test; whoever adds a question raises the floor.
// COUNTER: LibraryFastPathChecksPassed >= 54000
// STATISTIC: MemberLookupChecksLeftGeneric <= 0
import { Duplex, finished, pipeline, Readable, Transform, Writable } from "node:stream";

let bytes = 0;
let ends = 0;
for (let turn = 0; turn < 200; turn++) {
  await new Promise((resolve, reject) => {
    let left = 3;
    const source = new Readable({
      read() {
        this.push(left-- > 0 ? "made up " + turn : null);
      },
    });
    const middle = new Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk);
      },
    });
    const sink = new Writable({
      write(chunk, encoding, callback) {
        bytes += chunk.length;
        callback();
      },
    });
    finished(sink, () => ends++);
    pipeline(source, middle, sink, error => (error ? reject(error) : resolve()));
    if (source.destroyed || middle.destroyed || !sink.writable || middle.errored || sink.writableLength < 0)
      reject(new Error("touched"));
  });
}
const both = new Duplex({
  read() {},
  write(chunk, encoding, callback) {
    callback();
  },
});
both.setEncoding("utf8");
both.push("text");
console.log(bytes, ends, both.read(), both.destroyed, both.readableEncoding);
