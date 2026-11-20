// push() of a Readable in object mode, in every state the stream can be in: what it answers, who hears the chunk, what is held back, and what the state says behind it.
import { Readable, Writable } from "node:stream";

const log = [];
const say = (...words) => log.push(words.join(" "));
const tick = () => new Promise(resolve => setImmediate(resolve));
const look = stream => {
  const s = stream._readableState;
  return [s.length, s.buffer.length - s.bufferIndex, s.flowing, s.reading, s.sync, s.ended, s.dataEmitted, s.needReadable, s.readingMore, s.multiAwaitDrain, s.awaitDrainWriters === null ? "null" : s.awaitDrainWriters instanceof Set ? "set" + s.awaitDrainWriters.size : "writer", stream.readableDidRead].join();
};
const sink = () => new Writable({ objectMode: true, highWaterMark: 1, write(chunk, encoding, done) { setImmediate(done); } });

const states = {
  "nobody listens": () => {},
  "a listener of data": stream => stream.on("data", chunk => say("    heard", String(chunk))),
  "a listener of data, paused": stream => { stream.on("data", chunk => say("    heard", String(chunk))); stream.pause(); },
  "resumed without a listener": stream => stream.resume(),
  "a listener of readable": stream => stream.on("readable", () => say("    readable")),
  "both listeners": stream => { stream.on("readable", () => say("    readable")); stream.on("data", chunk => say("    heard", String(chunk))); },
  "a listener of data that has left": stream => { const gone = () => {}; stream.on("data", gone); stream.off("data", gone); },
  "something is held back": stream => { stream.push("held"); stream.on("data", chunk => say("    heard", String(chunk))); },
  "ended": stream => { stream.on("data", chunk => say("    heard", String(chunk))); stream.push(null); },
  "destroyed": stream => { stream.on("data", chunk => say("    heard", String(chunk))); stream.destroy(); },
  "failed": stream => { stream.on("data", chunk => say("    heard", String(chunk))); stream.destroy(new Error("failed")); },
  "marked as failed": stream => { stream.on("data", chunk => say("    heard", String(chunk))); stream._readableState.errored = new Error("marked"); },
  "an encoding": stream => { stream.setEncoding("hex"); stream.on("data", chunk => say("    heard", String(chunk))); },
  "one pipe": stream => stream.pipe(sink()),
  "two pipes": stream => { stream.pipe(sink()); stream.pipe(sink()); },
  "a pipe that waits for its drain": async stream => { stream.pipe(sink()); await tick(); stream.push("first"); stream.push("second"); },
  "it has flowed, then it ended and stays": async stream => { stream.on("data", chunk => say("    heard", String(chunk))); await tick(); stream.push(null); await tick(); },
  "it has flowed, then it was destroyed": async stream => { stream.on("data", chunk => say("    heard", String(chunk))); await tick(); stream.destroy(); },
  "it has flowed, then it was marked as failed": async stream => { stream.on("data", chunk => say("    heard", String(chunk))); await tick(); stream._readableState.errored = new Error("marked"); },
  "it has flowed, and a writer is laid in its state by hand": async stream => { stream.on("data", chunk => say("    heard", String(chunk))); await tick(); stream._readableState.awaitDrainWriters = sink(); },
};
const chunks = ["text", 0, "", false, undefined, Buffer.from("ab"), { a: 1 }];

for (const title in states) {
  for (const waits of [false, true]) {
    say("==", title, waits ? "| a turn later" : "| at once");
    const stream = new Readable({ objectMode: true, highWaterMark: 2, autoDestroy: !title.endsWith("stays"), read() {} });
    stream.on("error", error => say("    error", error.code ?? error.message));
    await states[title](stream);
    if (waits) await tick();
    for (const chunk of chunks) {
      const before = look(stream);
      let answer;
      try {
        answer = stream.push(chunk);
      } catch (error) {
        answer = "threw " + error.constructor.name;
      }
      say("  push", typeof chunk, answer, "|", before, ">", look(stream));
    }
    await tick();
    say("  later", look(stream));
    stream.destroy();
    await tick();
  }
}

say("== pushed by a listener while more is held back");
{
  const stream = new Readable({ objectMode: true, highWaterMark: 10, read() {} });
  for (const chunk of ["one", "two", "three"]) stream.push(chunk);
  let pushed = 0;
  stream.on("data", chunk => {
    say("    heard", chunk, "|", look(stream));
    if (pushed++ < 2) say("    push", stream.push("late" + pushed), "|", look(stream));
  });
  await tick();
  await tick();
  stream.destroy();
}

say("== pushed from inside _read");
{
  let n = 0;
  const stream = new Readable({
    objectMode: true,
    read() {
      const before = look(this);
      const answer = n < 3 ? this.push("r" + n++) : this.push(null);
      say("  push", answer, "|", before, ">", look(this));
    },
  });
  stream.on("data", chunk => say("    heard", chunk));
  await new Promise(resolve => stream.on("close", resolve));
}

console.log(log.join("\n"));
