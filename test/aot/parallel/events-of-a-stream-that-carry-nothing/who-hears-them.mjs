// "readable", "end", "resume", "pause" and "close" of a stream: who hears them, in which order, with what `this` and how many arguments, and through whose emit().
import { EventEmitter } from "node:events";
import { Duplex, Readable, Writable } from "node:stream";

const log = [];
const say = (...words) => log.push(words.join(" "));
const tick = () => new Promise(resolve => setImmediate(resolve));
const events = ["readable", "end", "resume", "pause", "close"];

async function live(stream) {
  stream.push?.("a");
  await tick();
  stream.read?.();
  stream.resume?.();
  await tick();
  stream.pause?.();
  stream.resume?.();
  stream.push?.(null);
  stream.end?.();
  await tick();
  await tick();
  stream.destroy();
  await tick();
}
async function turn(title, make, prepare) {
  say("==", title);
  const stream = make();
  stream.on("error", error => say("  error", error.message));
  try {
    prepare(stream);
    await live(stream);
  } catch (error) {
    say("  threw", error.constructor.name, error.message);
  }
}
const readable = () => new Readable({ read() {} });
const hear = (stream, label) => {
  for (const event of events) stream.on(event, function (...args) { say("  " + label, event, args.length, this === stream); });
};

await turn("nobody listens", readable, () => {});
await turn("one listener each", readable, stream => hear(stream, "heard"));
await turn("three listeners each", readable, stream => { hear(stream, "first"); hear(stream, "second"); hear(stream, "third"); });
await turn("once", readable, stream => { for (const event of events) stream.once(event, () => say("  once", event, stream.listenerCount(event))); });
await turn("once beside a listener that stays", readable, stream => { for (const event of events) stream.once(event, () => say("  once", event)); hear(stream, "stays"); });
await turn("a listener that leaves while it hears", readable, stream => {
  for (const event of events) {
    const leaves = () => (say("  leaves", event), stream.off(event, leaves));
    stream.on(event, leaves);
  }
  hear(stream, "stays");
});
await turn("a listener that brings another", readable, stream => {
  for (const event of events) stream.once(event, () => stream.on(event, () => say("  brought", event)));
});
await turn("a listener that throws at end", readable, stream => {
  process.once("uncaughtException", error => say("  uncaught", error.message));
  stream.on("end", () => { throw new Error("at end"); });
  stream.on("end", () => say("  the second listener of end"));
  stream.on("close", () => say("  close"));
});
await turn("an emit of its own", readable, stream => {
  stream.emit = function (type, ...args) {
    say("  emit", String(type), args.length);
    return EventEmitter.prototype.emit.call(this, type, ...args);
  };
  hear(stream, "heard");
});
await turn("an emit through an accessor", readable, stream => {
  Object.defineProperty(stream, "emit", { configurable: true, get() { say("  emit is read"); return EventEmitter.prototype.emit; } });
  hear(stream, "heard");
});
class Loud extends Readable {
  _read() {}
  emit(type, ...args) {
    say("  the class emits", String(type), args.length);
    return super.emit(type, ...args);
  }
}
await turn("an emit of the class", () => new Loud(), stream => hear(stream, "heard"));
await turn("rejections are captured", () => new Readable({ captureRejections: true, read() {} }), stream => {
  stream.on("resume", async () => { throw new Error("rejected at resume"); });
  hear(stream, "heard");
});
await turn("events that the program has replaced", readable, stream => {
  stream._events = { __proto__: null, end: () => say("  the new end"), close: [() => say("  close one"), () => say("  close two")] };
});
await turn("a writable", () => new Writable({ write(chunk, encoding, done) { done(); } }), stream => hear(stream, "heard"));
await turn("a duplex", () => new Duplex({ read() {}, write(chunk, encoding, done) { done(); } }), stream => hear(stream, "heard"));
await turn("no close is emitted", () => new Readable({ emitClose: false, read() {} }), stream => hear(stream, "heard"));

say("== an emit that is no function");
for (const deed of ["pause", "resume", "destroy"]) {
  const stream = readable();
  stream.resume();
  await tick();
  if (deed === "resume") stream.pause();
  stream.emit = 7;
  process.once("uncaughtException", error => say("  uncaught", error.constructor.name, error.message));
  try {
    stream[deed]();
    await tick();
  } catch (error) {
    say("  threw", error.constructor.name, error.message);
  }
  delete stream.emit;
  stream.destroy();
  await tick();
}

console.log(log.join("\n"));
