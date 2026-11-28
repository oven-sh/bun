// The first read of a default import of node:zlib is made in a function that a timer calls: the module was loaded before, and the ticks and jobs of that turn keep their order.
import zlib from "node:zlib";
const log = [];
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype
    ? "nothing above process"
    : "events above process";
function read() {
  log.push("read " + typeof zlib.gzipSync);
}
setTimeout(() => {
  log.push("timer", above());
  process.nextTick(() => log.push("tick"));
  Promise.resolve().then(() => log.push("job"));
  read();
  queueMicrotask(() => log.push("microtask"));
  process.nextTick(() => log.push("tick behind the read"));
  setImmediate(() => console.log(log.join(", ")));
}, 1);
log.push("body");
