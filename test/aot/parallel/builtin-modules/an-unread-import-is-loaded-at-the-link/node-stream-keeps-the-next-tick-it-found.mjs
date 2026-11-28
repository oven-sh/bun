// node:stream keeps the process.nextTick that it found while it loaded, at the link: a replacement that the body stores sees no call when a stream that is destroyed reports its error.
import { Readable } from "node:stream";
const calls = [];
const nextTick = process.nextTick;
process.nextTick = function (...args) {
  calls.push("process.nextTick");
  return nextTick.apply(this, args);
};
const stream = new Readable({ read() {} });
stream.on("error", error => calls.push("the listener got " + error.message));
stream.destroy(new Error("made up"));
setImmediate(() => {
  console.log(calls.join(", "));
  process.nextTick(() => console.log(calls.join(", ")));
});
