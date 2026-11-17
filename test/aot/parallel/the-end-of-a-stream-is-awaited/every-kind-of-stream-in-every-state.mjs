// finished() on every kind of stream, in every state it can be met in, under every option: what the callback gets, when, and which listeners lie on the stream meanwhile.
import { EventEmitter } from "node:events";
import { Duplex, PassThrough, Readable, Transform, Writable, finished } from "node:stream";

const log = [];
const say = (...words) => log.push(words.join(" "));
const tick = () => new Promise(resolve => setImmediate(resolve));
const name = key => (typeof key === "symbol" ? key.toString() : key);
const counts = stream => stream.eventNames().map(key => name(key) + ":" + stream.listenerCount(key)).join() || "none";

const kinds = {
  readable: () => new Readable({ read() {} }),
  writable: () => new Writable({ write(chunk, encoding, done) { done(); } }),
  duplex: () => new Duplex({ read() {}, write(chunk, encoding, done) { done(); } }),
  "duplex that may not stay half open": () => new Duplex({ allowHalfOpen: false, read() {}, write(chunk, encoding, done) { done(); } }),
  "duplex without a readable side": () => new Duplex({ readable: false, write(chunk, encoding, done) { done(); } }),
  "duplex without a writable side": () => new Duplex({ writable: false, read() {} }),
  transform: () => new Transform({ transform(chunk, encoding, done) { done(null, chunk); } }),
  passthrough: () => new PassThrough(),
  "readable that does not destroy itself": () => new Readable({ autoDestroy: false, read() {} }),
  "writable that emits no close": () => new Writable({ emitClose: false, write(chunk, encoding, done) { done(); } }),
  "writable whose writes never come back": () => new Writable({ write() {} }),
  "duplex that does not destroy itself": () => new Duplex({ autoDestroy: false, read() {}, write(chunk, encoding, done) { done(); } }),
};
const deeds = {
  nothing: () => {},
  "ends its readable side": stream => { if (stream.push) { stream.push(null); stream.resume(); } },
  "ends its writable side": stream => { stream.end?.(); },
  "ends both": stream => { stream.end?.(); if (stream.push) { stream.push(null); stream.resume(); } },
  "is destroyed": stream => { stream.destroy(); },
  "is destroyed with an error": stream => { stream.destroy(new Error("destroyed")); },
  "emits an error by hand": stream => { stream.emit("error", new Error("by hand")); },
  "emits close by hand": stream => { stream.emit("close"); },
  "writes, and ends while that waits": stream => { stream.cork?.(); stream.write?.("x"); stream.end?.(); },
  "has read to its end, and nobody has heard": stream => { if (stream.push) { stream.push(null); stream.read(); } },
  "fails without destroying itself": stream => { const state = stream._writableState ?? stream._readableState; state.errored = new Error("marked"); state.errorEmitted = true; },
};
const lists = {
  "no options": undefined,
  "readable alone": { writable: false },
  "writable alone": { readable: false },
  "neither": { readable: false, writable: false },
  "errors are not heard": { error: false },
};

for (const kind in kinds) {
  for (const deed in deeds) {
    for (const list in lists) {
      for (const when of ["long before", "just before", "behind"]) {
        const stream = kinds[kind]();
        stream.on("error", () => {});
        const answers = [];
        if (when !== "behind") deeds[deed](stream);
        if (when === "long before") {
          await tick();
          await tick();
        }
        const before = counts(stream);
        const heard = function (...args) {
          answers.push((this === stream ? "" : "ANOTHER THIS ") + args.length + ":" + (args[0]?.code ?? args[0]?.message ?? String(args[0])));
        };
        const cleanup = lists[list] === undefined ? finished(stream, heard) : finished(stream, lists[list], heard);
        const laid = counts(stream);
        const atOnce = answers.length;
        if (when === "behind") deeds[deed](stream);
        await tick();
        await tick();
        const behind = counts(stream);
        cleanup();
        say(kind, "|", deed, when, "|", list, "|", before, ">", laid, ">", behind, ">", counts(stream), "| at once", atOnce, "|", answers.join(" ") || "no answer");
        stream.destroy();
        await tick();
      }
    }
  }
}

console.log(log.join("\n"));
