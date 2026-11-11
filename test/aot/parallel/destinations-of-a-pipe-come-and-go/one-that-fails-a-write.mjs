// A destination that fails a write in its own call, beside the others of one Readable: what the others get once it is gone, whether the source still waits for one that has not drained,
// what becomes of a source that the program paused or destroyed meanwhile, and of one that only flagged itself destroyed before its end.
import { Readable, Writable } from "node:stream";

const turn = () => new Promise(resolve => setImmediate(resolve));
const reading = () => {
  const chunks = ["a", "b", "c"];
  const source = new Readable({ read() { this.push(chunks.length ? chunks.shift() : null); } });
  source.on("end", () => console.log("  end"));
  return source;
};
const pushed = () => new Readable({ read() {} });
const sink = (name = "good") => {
  const it = new Writable({ write(chunk, encoding, done) { console.log("  " + name, "got", String(chunk)); done(); } });
  it.on("finish", () => console.log("  " + name, "finish"));
  return it;
};
const failing = (write = (chunk, encoding, done) => done(new Error("fail"))) => {
  const it = new Writable({ write });
  it.on("error", error => console.log("  bad error:", error.message));
  return it;
};
const waitedOnce = () => new Writable({ highWaterMark: 1, write(chunk, encoding, done) { process.nextTick(done); } });
const say = source => console.log("  flowing", source.readableFlowing, "| paused", source.isPaused(), "| buffered", source.readableLength, "| left", source._readableState.pipes.length);

console.log("the failing one first");
{
  const source = reading();
  source.pipe(failing());
  source.pipe(sink());
  await turn();
  say(source);
}
console.log("the failing one between two others");
{
  const source = reading();
  source.pipe(sink("first"));
  source.pipe(failing());
  source.pipe(sink("last"));
  await turn();
  say(source);
}
console.log("a write that throws");
{
  const source = reading();
  source.pipe(failing(() => { throw new Error("fail"); }));
  source.pipe(sink());
  await turn();
  say(source);
}
console.log("a listener of data beside the failing one");
{
  const source = reading();
  source.pipe(failing());
  source.on("data", chunk => console.log("  data", String(chunk)));
  await turn();
  say(source);
}
console.log("one that has not drained");
{
  const source = reading();
  let drain;
  const slow = new Writable({ highWaterMark: 1, write(chunk, encoding, done) { console.log("  slow got", String(chunk)); drain = done; } });
  slow.on("finish", () => console.log("  slow finish"));
  source.pipe(failing());
  source.pipe(slow);
  for (let i = 0; i < 4; i++) {
    await turn();
    say(source);
    const done = drain;
    drain = undefined;
    done?.();
  }
}
console.log("a source that the program paused");
{
  const source = pushed();
  const once = waitedOnce();
  source.pipe(once);
  source.pipe(sink());
  source.push("a");
  await turn();
  source.pause();
  source.unpipe(once);
  say(source);
  source.push("b");
  await turn();
  say(source);
}
console.log("every destination at once");
{
  const source = pushed();
  source.pipe(waitedOnce());
  source.pipe(sink());
  source.push("a");
  await turn();
  source.unpipe();
  say(source);
  source.push("b");
  await turn();
  say(source);
}
console.log("a destroyed source, and one in backpressure goes");
{
  const source = pushed();
  const stuck = new Writable({ highWaterMark: 1, write() {} });
  source.pipe(stuck);
  source.pipe(sink());
  source.push("a");
  await turn();
  source.push("b");
  source.destroy();
  await turn();
  source.on("resume", () => console.log("  resume"));
  source.unpipe(stuck);
  await turn();
  say(source);
}
console.log("a destroyed source, and one drains");
{
  const source = pushed();
  let drain;
  const slow = new Writable({ highWaterMark: 1, write(chunk, encoding, done) { drain = done; } });
  source.pipe(slow);
  source.pipe(sink());
  source.push("a");
  await turn();
  source.push("b");
  source.destroy();
  await turn();
  source.on("resume", () => console.log("  resume"));
  drain();
  await turn();
  say(source);
}
console.log("a destroyed source, and the failing one goes");
{
  const source = pushed();
  source.pipe(failing());
  source.pipe(sink());
  source.once("data", () => {
    source.destroy();
    source.on("resume", () => console.log("  resume"));
  });
  source.push("a");
  source.push("b");
  await turn();
  say(source);
}
console.log("a source that says it is destroyed before its end");
{
  const chunks = ["a", "b"];
  const source = new Readable({
    read() {
      if (chunks.length) return this.push(chunks.shift());
      this.destroyed = true;
      this.push(null);
    },
  });
  source.on("end", () => console.log("  end"));
  source.pipe(failing());
  source.pipe(sink());
  await turn();
  say(source);
}
