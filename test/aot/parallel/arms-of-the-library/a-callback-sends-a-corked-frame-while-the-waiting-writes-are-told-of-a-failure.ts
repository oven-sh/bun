// A write fails while others wait behind it, and nothing is corked. The waiting writes are told of it one by one, and the callback of one of them sends the next message as a corked frame:
// a header and a body between cork() and uncork(). The list of waiting writes changes under the loop that tells them. Once with write() alone, once with writev() beside it.
// The lines are held to what node 25.6 prints, whoever runs the program.
import { Writable } from "node:stream";
const said: string[] = [];
const say = (word: string) => said.push(word);
function make(takesMany: boolean): Writable {
  let writes = 0;
  const stream = new Writable({
    write(chunk, encoding, done) {
      if (writes++ === 0) setImmediate(() => done(new Error("a failed")));
      else done();
    },
    ...(takesMany
      ? {
          writev(chunks: { chunk: unknown }[], done: () => void) {
            say("writev " + chunks.map(it => it.chunk).join());
            done();
          },
        }
      : {}),
  });
  stream.on("error", error => say("error " + error.message));
  stream.on("close", () => say("close"));
  return stream;
}
async function tell(name: string, takesMany: boolean): Promise<void> {
  say(name);
  const stream = make(takesMany);
  const sendFrame = (text: string) => {
    stream.cork();
    stream.write("header", () => say("callback header"));
    stream.write(text, () => say("callback " + text));
    stream.uncork();
  };
  stream.write("a", () => say("callback a"));
  stream.write("b", () => {
    say("callback b");
    sendFrame("d");
  });
  stream.write("c", () => say("callback c"));
  await new Promise(resolve => setTimeout(resolve, 60));
  say("destroyed " + stream.destroyed + " closed " + stream.closed + " waiting " + stream.writableLength);
}
await tell("one at a time", false);
await tell("many at a time", true);
console.log(said.join("\n"));
const asInNode = [
  "one at a time",
  "callback a",
  "callback b",
  "callback b",
  "callback c",
  "callback header",
  "callback d",
  "error a failed",
  "close",
  "callback header",
  "callback d",
  "destroyed true closed true waiting -1",
  "many at a time",
  "callback a",
  "callback b",
  "writev b,c,header,d",
  "callback b",
  "callback c",
  "callback header",
  "callback d",
  "error a failed",
  "close",
  "callback header",
  "callback d",
  "destroyed true closed true waiting 0",
];
if (said.join("\n") !== asInNode.join("\n")) {
  console.error("node 25.6 prints:\n" + asInNode.join("\n"));
  process.exit(1);
}
process.exit(0);
