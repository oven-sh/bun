import { Duplex, PassThrough, Readable } from "node:stream";

const lines = [];
const listener = () => {};
const mark = Symbol("made up");
const deeds = [
  ["on close", "close", stream => stream.on("close", listener)],
  ["on end", "end", stream => stream.on("end", listener)],
  ["on error", "error", stream => stream.on("error", listener)],
  ["on data", "data", stream => stream.on("data", listener)],
  ["on readable", "readable", stream => stream.on("readable", listener)],
  ["on four", "four", stream => stream.on("four", listener)],
  ["on a symbol", mark, stream => stream.on(mark, listener)],
  ["once close", "close", stream => stream.once("close", listener)],
  ["addListener pause", "pause", stream => stream.addListener("pause", listener)],
  ["prependListener close", "close", stream => stream.prependListener("close", listener)],
  ["removeListener close", "close", stream => stream.removeListener("close", listener)],
  ["off error", "error", stream => stream.off("error", listener)],
  ["off data", "data", stream => stream.off("data", listener)],
  ["off a symbol", mark, stream => stream.off(mark, listener)],
  ["removeAllListeners close", "close", stream => stream.removeAllListeners("close")],
];
const kinds = [
  ["Readable", () => new Readable({ read() {} })],
  ["Duplex", () => new Duplex({ read() {}, write(chunk, encoding, done) { done(); } })],
  ["PassThrough", () => new PassThrough()],
  ["an heir", () => new (class extends Readable { _read() {} })()],
];
for (const [kind, make] of kinds) {
  for (const [title, name, deed] of deeds) {
    for (const how of ["throws once", "throws always", "answers"]) {
      const stream = make();
      if (/^(remove|off)/.test(title)) stream.on(name, listener);
      const state = stream._readableState;
      let isFirst = true;
      Object.defineProperty(stream, "_readableState", {
        get() {
          if (how === "throws always" || (how === "throws once" && isFirst)) {
            isFirst = false;
            throw new RangeError("made up");
          }
          return state;
        },
        set() {},
        configurable: true,
      });
      let said;
      try {
        said = deed(stream) === stream ? "returned the stream" : "returned something else";
      } catch (error) {
        said = "threw " + error.name;
      }
      Object.defineProperty(stream, "_readableState", { value: state, writable: true, configurable: true });
      lines.push([kind, title, how, said, "listeners " + stream.listenerCount(name), "flowing " + stream.readableFlowing].join(" | "));
    }
  }
}
console.log(lines.join("\n"));
