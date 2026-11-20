// A destination that fails a write in its own call, beside the others of one Readable: what the others get once it is gone, whether the source still waits for one that has not drained,
// what becomes of a source that the program paused or destroyed meanwhile, and of one that only flagged itself destroyed before its end.
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

const turn = () => new Promise(resolve => setImmediate(resolve));
const reading = () => {
  const chunks = ["a", "b", "c"];
  const source = new Readable({ read() { this.push(chunks.length ? chunks.shift() : null); } });
  source.on("end", () => console.log("  end"));
  return source;
};
const pushed = options => new Readable({ read() {}, ...options });
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
console.log("one that destroys itself and says no error");
{
  const source = reading();
  const gone = new Writable({ write(chunk, encoding, done) { this.destroy(); done(); } });
  gone.on("close", () => console.log("  bad close"));
  source.pipe(gone);
  source.pipe(sink());
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
for (const [title, first, listens] of [
  ["every destination at once, the first one waited once", waitedOnce, false],
  ["every destination at once, the first one is in backpressure", () => new Writable({ highWaterMark: 1, write() {} }), false],
  ["every destination at once, beside a listener of data", waitedOnce, true],
]) {
  console.log(title);
  const source = pushed();
  if (listens) source.on("data", chunk => console.log("  data", String(chunk)));
  source.pipe(first());
  source.pipe(sink());
  source.push("a");
  await turn();
  source.unpipe();
  say(source);
  source.push("b");
  await turn();
  say(source);
}
console.log("a listener of unpipe that reads, so that nobody is on record as waited for");
{
  const source = reading();
  const bad = failing();
  bad.on("unpipe", () => source.read());
  source.pipe(bad);
  source.pipe(sink());
  await turn();
  say(source);
}
console.log("every destination at once in the tick of the failed write, beside a listener of data");
{
  const source = reading();
  source.pipe(failing());
  source.once("data", () => source.unpipe());
  source.on("data", chunk => console.log("  data", String(chunk)));
  await turn();
  say(source);
}
console.log("every destination at once in the tick of the failed write, then two more of which the second is busy");
{
  const source = pushed();
  source.pipe(failing());
  let drained;
  const busy = new Writable({
    highWaterMark: 1,
    write(chunk, encoding, done) {
      if (String(chunk) !== "first") console.log("  busy got", String(chunk));
      drained = done;
    },
  });
  busy.write("first");
  source.once("data", () => {
    source.unpipe();
    source.pipe(sink());
    source.pipe(busy);
  });
  source.push("a");
  await turn();
  drained();
  await turn();
  source.push("b");
  await turn();
  say(source);
}
console.log("a source that the program paused, and the one pipe that is left of two goes");
{
  const source = pushed();
  const once = waitedOnce();
  source.on("data", chunk => console.log("  data", String(chunk)));
  source.pipe(once);
  source.push("a");
  await turn();
  const second = sink("second");
  source.pipe(second);
  source.unpipe(second);
  source.pause();
  source.unpipe(once);
  say(source);
  source.push("b");
  await turn();
  say(source);
}
for (const [title, options, ended] of [
  ["a destroyed source, and the failing one goes", {}, false],
  ["a source whose destroy has not called back, and the failing one goes", { destroy() {} }, false],
  ["a source destroyed behind its end, and the failing one goes", {}, true],
]) {
  console.log(title);
  const source = pushed(options);
  source.pipe(failing());
  source.pipe(sink());
  source.once("data", () => {
    source.destroy();
    source.on("resume", () => console.log("  resume"));
  });
  source.push("a");
  source.push("b");
  if (ended) source.push(null);
  await turn();
  say(source);
}
for (const [title, destination] of [
  ["a source that only says it is destroyed, and one in backpressure goes", () => new Writable({ highWaterMark: 1, write() {} })],
  ["a source that only says it is destroyed, and one with no state goes", () => Object.assign(new EventEmitter(), { write: () => false, end() {} })],
]) {
  console.log(title);
  const source = pushed();
  const stuck = destination();
  source.on("end", () => console.log("  end"));
  source.pipe(stuck);
  source.pipe(sink());
  source.push("a");
  await turn();
  source.push("b");
  source.destroyed = true;
  source.push(null);
  source.unpipe(stuck);
  await turn();
  say(source);
}
