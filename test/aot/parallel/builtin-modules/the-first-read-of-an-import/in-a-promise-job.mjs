// The first read of a named import of node:stream is made in a function that a promise job calls: the module was loaded before, so the first tick of the process waits for the jobs.
import { Readable } from "node:stream";
const log = [];
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype
    ? "nothing above process"
    : "events above process";
function read() {
  log.push("read " + typeof Readable.from);
}
Promise.resolve().then(() => {
  log.push("job", above());
  process.nextTick(() => log.push("tick"));
  Promise.resolve().then(() => log.push("job 2"));
  read();
  queueMicrotask(() => log.push("microtask"));
  process.nextTick(() => log.push("tick behind the read"));
});
setImmediate(() => console.log(log.join(", ")));
log.push("body");
