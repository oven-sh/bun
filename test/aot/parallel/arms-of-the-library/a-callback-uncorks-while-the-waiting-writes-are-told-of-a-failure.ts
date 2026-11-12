// A write in flight fails while the stream is corked. The waiting writes are told of it one by one, and the first one's callback uncorks: what still waits is sent on meanwhile.
// The list of waiting writes is read anew in every turn, as in node 26. The lines are held to what node 26 prints, whoever runs the program.
import { Writable } from "node:stream";
let said: string[] = [];
const say = (word: string) => said.push(word);
process.on("uncaughtException", error => say("nobody catches " + error.name));
function make(kind: string): Writable {
  let first = true;
  const stream = new Writable({
    write(chunk, encoding, done) {
      say("write " + chunk);
      if (first) {
        first = false;
        setImmediate(() => done(new Error("a failed")));
      } else if (kind === "at once") done();
      else setImmediate(done);
    },
    ...(kind === "many at a time"
      ? {
          writev(chunks: { chunk: unknown }[], done: () => void) {
            say("writev " + chunks.map(it => it.chunk).join());
            setImmediate(done);
          },
        }
      : {}),
  });
  stream.on("error", error => say("error " + error.message));
  stream.on("finish", () => say("finish"));
  stream.on("close", () => say("close"));
  return stream;
}
const told = (name: string) => (error?: Error | null) => say(name + " " + (error ? "failed" : "fine"));
const lines: string[] = [];
for (const kind of ["at once", "many at a time", "later"]) {
  said = [];
  const stream = make(kind);
  stream.write("a", told("a"));
  stream.cork();
  stream.write("b", error => {
    told("b")(error);
    stream.uncork();
  });
  stream.write("c", told("c"));
  stream.write("d", told("d"));
  await new Promise(resolve => setTimeout(resolve, 100));
  lines.push(kind + ": " + said.join(" | ") + " | length " + stream.writableLength + " destroyed " + stream.destroyed);
}
console.log(lines.join("\n"));
const asInNode = [
  "at once: write a | a failed | b failed | write b | write c | write d | b fine | c fine | d fine | error a failed | close | length -1 destroyed true",
  "many at a time: write a | a failed | b failed | writev b,c,d | error a failed | close | b fine | c fine | d fine | length 0 destroyed true",
  "later: write a | a failed | b failed | write b | c failed | d failed | error a failed | close | b fine | length -1 destroyed true",
];
// No throw: the listener above would take it, and the program would end well.
if (lines.join("\n") !== asInNode.join("\n")) {
  console.error("node 26 prints:\n" + asInNode.join("\n"));
  process.exit(1);
}
process.exit(0);
