// stream.isDestroyed(), isReadable(), isWritable() and destroy() of node:stream on streams, on what passes for one, and on what does not: the answers, and for a Proxy every read.
import { EventEmitter } from "node:events";
import stream, { Duplex, PassThrough, Readable, Writable } from "node:stream";

const tick = () => new Promise(resolve => setImmediate(resolve));
const kIsDestroyed = Symbol.for("nodejs.stream.destroyed");
const ask = (title, value) => console.log(title, "|", stream.isDestroyed(value), stream.isReadable(value), stream.isWritable(value), stream.isErrored(value), stream.isDisturbed(value));

for (const value of [undefined, null, 0, 5, "", "text", true, Symbol("s"), 10n, {}, [], () => {}, new EventEmitter()]) ask("what is no stream: " + typeof value + " " + String(typeof value === "symbol" ? "symbol" : value), value);

const makers = {
  readable: () => new Readable({ read() {} }),
  writable: () => new Writable({ write(chunk, encoding, done) { done(); } }),
  duplex: () => new Duplex({ read() {}, write(chunk, encoding, done) { done(); } }),
  passthrough: () => new PassThrough(),
};
for (const kind in makers) {
  const fresh = makers[kind]();
  ask(kind + ", fresh", fresh);
  const destroyed = makers[kind]();
  destroyed.destroy();
  ask(kind + ", destroyed at once", destroyed);
  await tick();
  ask(kind + ", destroyed, later", destroyed);
  const failed = makers[kind]();
  failed.on("error", () => {});
  failed.destroy(new Error("failed"));
  await tick();
  ask(kind + ", failed", failed);
  const ended = makers[kind]();
  ended.end?.();
  ended.push?.(null);
  ended.resume?.();
  await tick();
  await tick();
  ask(kind + ", ended", ended);
  const marked = makers[kind]();
  marked[kIsDestroyed] = true;
  ask(kind + ", marked under the symbol", marked);
  const hidden = makers[kind]();
  Object.defineProperty(hidden, "destroyed", { value: false });
  (hidden._writableState ?? hidden._readableState).destroyed = true;
  ask(kind + ", says no and its state says yes", hidden);
  const byHelper = makers[kind]();
  byHelper.on("error", () => {});
  stream.destroy(byHelper);
  ask(kind + ", destroyed by stream.destroy()", byHelper);
  await tick();
}

const shapes = {
  "it pipes and listens": { pipe() {}, on() {} },
  "it writes and listens": { write() {}, on() {} },
  "it pipes alone": { pipe() {} },
  "it says destroyed": { pipe() {}, on() {}, destroyed: true },
  "it says so in other words": { pipe() {}, on() {}, destroyed: "yes" },
  "a readable state of its own": { _readableState: { destroyed: true } },
  "a writable state of its own": { _writableState: { destroyed: 1 } },
  "both, and the writable one says no": { _writableState: { destroyed: false }, _readableState: { destroyed: true } },
  "the library's readable state where the writable one belongs": { _writableState: Object.assign(new Readable()._readableState, { destroyed: true }) },
  "the library's writable state where the readable one belongs": { _readableState: Object.assign(new Writable()._writableState, { destroyed: true }) },
  "the same, and the state itself says no": { _writableState: Object.defineProperty(Object.assign(new Readable()._readableState, { destroyed: true }), "destroyed", { value: false }) },
  "the writable state for the readable one, and the state itself says no": { _readableState: Object.defineProperty(Object.assign(new Writable()._writableState, { destroyed: true }), "destroyed", { value: false }) },
  "its own kind of state in its own place, and the state itself says no": { _readableState: Object.defineProperty(Object.assign(new Readable()._readableState, { destroyed: true }), "destroyed", { value: false }) },
  "states that are no objects": { _readableState: 1, _writableState: "w" },
  "a state that is a function": { _readableState: Object.assign(() => {}, { destroyed: true }) },
};
for (const title in shapes) ask(title, shapes[title]);
ask("a function that passes for a stream", Object.assign(() => {}, { pipe() {}, on() {}, destroyed: true }));

const reads = [];
const proxy = new Proxy(new Duplex({ read() {}, write() {} }), {
  get(target, key) {
    reads.push(String(key));
    return Reflect.get(target, key, target);
  },
});
console.log("a proxy |", stream.isDestroyed(proxy));
console.log(" ", reads.join());
