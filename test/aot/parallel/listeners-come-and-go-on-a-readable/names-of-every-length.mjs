// on(), addListener(), once(), off() and removeListener() of a Readable under names of every length and kind: only "data" and "readable" change how the stream flows.
import { Readable } from "node:stream";

const tick = () => new Promise(resolve => setImmediate(resolve));
const show = name => (typeof name === "symbol" ? name.toString() : typeof name + ":" + String(name));
const names = [
  "", "a", "end", "data", "date", "Data", "data", "däta", "da" + "ta", "data ", "close", "error2", "aborted", "readable", "readablE", "readable", "read" + "able", "readables", "unpipe12",
  "\u{1F600}\u{1F600}", "\u{1F600}\u{1F600}\u{1F600}\u{1F600}", 4, 8, 0, null, undefined, true, Symbol("data"), Symbol("readable"), Symbol.for("data"),
  new String("data"), new String("readable"), { toString: () => "data" }, ["data"], ["readable"],
];
const state = stream => [stream.readableFlowing, stream.isPaused(), stream._readableState.readableListening, stream._readableState.needReadable, stream._readableState.resumeScheduled, stream.listenerCount("data"), stream.listenerCount("readable")].join();

for (const method of ["on", "addListener", "once", "prependListener"]) {
  for (const name of names) {
    const stream = new Readable({ read() {} });
    const listener = () => {};
    const before = state(stream);
    const answer = stream[method](name, listener);
    const laid = state(stream);
    await tick();
    const later = state(stream);
    for (const remove of ["removeListener", "off"]) {
      stream[remove](name, listener);
    }
    const removed = state(stream);
    await tick();
    console.log(method, show(name), "|", answer === stream, "|", before, ">", laid, ">", later, ">", removed, ">", state(stream), "|", stream.eventNames().length);
    stream.destroy();
  }
}

console.log("== data beside readable");
{
  const stream = new Readable({ read() {} });
  const onData = () => {}, onReadable = () => {};
  const steps = [
    ["on", "readable", onReadable], ["on", "data", onData], ["removeListener", "readable", onReadable], ["removeListener", "data", onData],
    ["on", "data", onData], ["on", "readable", onReadable], ["removeListener", "data", onData], ["removeListener", "readable", onReadable],
    ["on", "data", onData], ["on", "data", onReadable], ["removeListener", "data", onData], ["removeListener", "data", onReadable], ["removeListener", "data", onReadable],
  ];
  for (const [method, name, listener] of steps) {
    stream[method](name, listener);
    const atOnce = state(stream);
    await tick();
    console.log(" ", method, name, "|", atOnce, ">", state(stream));
  }
}
