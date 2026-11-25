// Beside node:http the compiler asks whether abort(), the getter of signal and the getter of aborted are as built when the program runs. Two quiet pipelines; then each of
// the three is replaced, and the last deleted, with a pipeline behind each step: what is replaced is heard from the next pipeline on.
import "node:http";
import { pipeline, Readable, Writable } from "node:stream";
const seen = { abort: 0, signal: 0, aborted: 0 };
const run = () =>
  new Promise(done =>
    pipeline(
      Readable.from(["a"]),
      new Writable({
        objectMode: true,
        write(chunk, encoding, callback) {
          callback();
        },
      }),
      error => setImmediate(done, error),
    ),
  );
await run();
await run();
console.log("quiet", seen.abort, seen.signal, seen.aborted);
const abort = AbortController.prototype.abort;
const signal = Object.getOwnPropertyDescriptor(AbortController.prototype, "signal");
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted");
AbortController.prototype.abort = function (...given) {
  seen.abort++;
  return abort.apply(this, given);
};
await run();
console.log("abort replaced", seen.abort > 0, seen.signal, seen.aborted);
Object.defineProperty(AbortController.prototype, "signal", {
  ...signal,
  get() {
    seen.signal++;
    return signal.get.call(this);
  },
});
await run();
console.log("signal replaced", seen.abort > 1, seen.signal > 0, seen.aborted);
Object.defineProperty(AbortSignal.prototype, "aborted", {
  ...aborted,
  get() {
    seen.aborted++;
    return aborted.get.call(this);
  },
});
await run();
console.log("aborted replaced", seen.abort > 2, seen.signal > 1, seen.aborted > 0);
delete AbortSignal.prototype.aborted;
await run();
console.log("aborted deleted", seen.abort > 3, seen.signal > 2);
