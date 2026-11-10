import { pipeline, Readable, Writable } from "node:stream";
const lines = [];
const seen = { abort: 0, signal: 0, aborted: 0 };
const abort = AbortController.prototype.abort;
const signal = Object.getOwnPropertyDescriptor(AbortController.prototype, "signal");
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted");
function replaceAll() {
  AbortController.prototype.abort = function (...given) {
    seen.abort++;
    return abort.apply(this, given);
  };
  Object.defineProperty(AbortController.prototype, "signal", {
    ...signal,
    get() {
      seen.signal++;
      return signal.get.call(this);
    },
  });
  Object.defineProperty(AbortSignal.prototype, "aborted", {
    ...aborted,
    get() {
      seen.aborted++;
      return aborted.get.call(this);
    },
  });
}
function putBack(label) {
  lines.push(label + ": abort " + seen.abort + " signal " + seen.signal + " aborted " + seen.aborted);
  seen.abort = seen.signal = seen.aborted = 0;
  AbortController.prototype.abort = abort;
  Object.defineProperty(AbortController.prototype, "signal", signal);
  Object.defineProperty(AbortSignal.prototype, "aborted", aborted);
}
const sink = write => new Writable({ objectMode: true, write });
await new Promise(resolve => {
  let isReplaced = false;
  pipeline(
    Readable.from(["a", "b"]),
    sink((chunk, encoding, callback) => {
      if (!isReplaced) replaceAll();
      isReplaced = true;
      callback();
    }),
    () => setImmediate(resolve),
  );
});
putBack("replaced in the first write");
await new Promise(resolve => {
  const source = Readable.from(["a", "b"]);
  const on = source.on;
  let isReplaced = false;
  source.on = function (...given) {
    if (!isReplaced) replaceAll();
    isReplaced = true;
    return on.apply(this, given);
  };
  pipeline(
    source,
    sink((chunk, encoding, callback) => callback()),
    () => setImmediate(resolve),
  );
});
putBack("replaced while the pipeline is laid");
console.log(lines.join("\n"));
process.exit(0);
