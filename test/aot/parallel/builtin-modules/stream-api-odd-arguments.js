const stream = require("node:stream");
const { Readable, Writable, Duplex, Transform, PassThrough } = stream;
const show = value => { try { return typeof value === "symbol" ? String(value) : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value.slice(0, 40)) : typeof value === "function" ? "function" : value instanceof Error ? value.name + " " + (value.code ?? "") : value instanceof stream.Stream ? "a stream" : value instanceof Promise ? "a promise" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : ArrayBuffer.isView(value) ? "bytes " + value.length : typeof value === "object" && value !== null ? "object" : String(value); } catch (error) { return "unshowable"; } };
let notes = [];
process.on("uncaughtException", error => notes.push("UNCAUGHT " + show(error)));
process.on("unhandledRejection", error => notes.push("UNHANDLED " + show(error)));
const odd = () => [undefined, null, 0, -1, 1.5, NaN, Infinity, "", "x", "utf8", "nonsense", true, false, Symbol("s"), 5n, {}, [], () => {}, Buffer.from("b"), new Uint8Array(2), new Date(0), { length: 3 }, { then() {} }, Object.create(null)];
const makers = {
  readable: () => new Readable({ read() {} }),
  "readable of objects": () => new Readable({ objectMode: true, read() {} }),
  writable: () => new Writable({ write(chunk, encoding, callback) { callback(); } }),
  "writable of objects": () => new Writable({ objectMode: true, write(chunk, encoding, callback) { callback(); } }),
  duplex: () => new Duplex({ read() {}, write(chunk, encoding, callback) { callback(); } }),
  transform: () => new Transform({ transform(chunk, encoding, callback) { callback(null, chunk); } }),
  passthrough: () => new PassThrough(),
};
const methods = ["read", "push", "unshift", "setEncoding", "pipe", "unpipe", "wrap", "write", "end", "setDefaultEncoding", "destroy", "cork", "uncork", "pause", "resume", "isPaused", "on", "once", "off", "emit", "iterator", "map", "filter", "forEach", "toArray", "some", "find", "every", "flatMap", "drop", "take", "reduce", "compose", "setMaxListeners", "_read", "_write", "_final", "_destroy", "_undestroy"];
const properties = ["readable", "writable", "destroyed", "readableFlowing", "readableHighWaterMark", "writableHighWaterMark", "readableLength", "writableLength", "readableObjectMode", "writableObjectMode", "readableEncoding", "readableEnded", "writableEnded", "writableFinished", "writableCorked", "writableNeedDrain", "errored", "closed", "readableAborted", "writableAborted", "readableDidRead", "allowHalfOpen"];
const statics = { "Readable.from": Readable.from, "Readable.fromWeb": Readable.fromWeb, "Readable.toWeb": Readable.toWeb, "Readable.wrap": Readable.wrap, "Writable.fromWeb": Writable.fromWeb, "Writable.toWeb": Writable.toWeb, "Duplex.from": Duplex.from, "Duplex.fromWeb": Duplex.fromWeb, "Duplex.toWeb": Duplex.toWeb, isReadable: stream.isReadable, isWritable: stream.isWritable, isErrored: stream.isErrored, isDisturbed: stream.isDisturbed, isDestroyed: stream.isDestroyed, finished: stream.finished, pipeline: stream.pipeline, compose: stream.compose, addAbortSignal: stream.addAbortSignal, destroy: stream.destroy, getDefaultHighWaterMark: stream.getDefaultHighWaterMark, setDefaultHighWaterMark: stream.setDefaultHighWaterMark, duplexPair: stream.duplexPair, "new Readable": options => new Readable(options), "new Writable": options => new Writable(options), "new Duplex": options => new Duplex(options), "new Transform": options => new Transform(options), "new PassThrough": options => new PassThrough(options), "new Stream": options => new stream.Stream(options) };
const optionNames = ["highWaterMark", "readableHighWaterMark", "writableHighWaterMark", "objectMode", "readableObjectMode", "writableObjectMode", "encoding", "defaultEncoding", "decodeStrings", "emitClose", "autoDestroy", "signal", "read", "write", "writev", "final", "destroy", "construct", "transform", "flush", "allowHalfOpen", "readable", "writable", "captureRejections"];
const attempt = (title, run) => {
  notes = [];
  let said;
  try {
    const result = run();
    if (result instanceof Promise) result.catch(() => {});
    said = show(result);
  } catch (error) {
    said = "throws " + show(error);
  }
  return title + ": " + said;
};
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const high = stream.getDefaultHighWaterMark(false);
  const highOfObjects = stream.getDefaultHighWaterMark(true);
  const line = async text => { await tick(); console.log(text + (notes.length ? " . " + notes.join(" . ") : "")); };
  for (const [kind, make] of Object.entries(makers)) {
    for (const method of methods) {
      for (const value of odd()) {
        const made = make();
        made.on("error", error => notes.push("error " + show(error)));
        if (typeof made[method] !== "function") continue;
        await line(attempt(kind + "." + method + "(" + show(value) + ")", () => made[method](value)));
        await line(attempt(kind + "." + method + "(\"a\", " + show(value) + ")", () => made[method]("a", value)));
        made.destroy();
      }
    }
    for (const property of properties) {
      for (const value of odd()) {
        const made = make();
        made.on("error", error => notes.push("error " + show(error)));
        await line(attempt(kind + "." + property + " = " + show(value), () => { made[property] = value; return made[property]; }));
        made.destroy();
      }
    }
  }
  for (const [name, call] of Object.entries(statics)) {
    for (const value of odd()) {
      await line(attempt(name + "(" + show(value) + ")", () => call(value)));
      await line(attempt(name + "(a stream, " + show(value) + ")", () => call(new PassThrough().on("error", () => {}), value)));
      stream.setDefaultHighWaterMark(false, high);
      stream.setDefaultHighWaterMark(true, highOfObjects);
    }
  }
  for (const name of optionNames) {
    for (const value of odd()) {
      for (const [kind, Class] of Object.entries({ Readable, Writable, Duplex, Transform })) {
        await line(attempt("new " + kind + "({ " + name + ": " + show(value) + " })", () => { const made = new Class({ [name]: value }); made.on("error", error => notes.push("error " + show(error))); return [made.readableHighWaterMark, made.writableHighWaterMark, made.readableObjectMode, made.writableObjectMode, made.readableEncoding, made.readable, made.writable]; }));
      }
    }
  }
})();
