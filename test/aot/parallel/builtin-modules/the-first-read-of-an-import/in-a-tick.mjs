// The first read of a namespace of node:crypto is made in a function that a process.nextTick callback calls: the module was loaded before, and the ticks and jobs keep their order.
import * as crypto from "node:crypto";
const log = [];
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype
    ? "nothing above process"
    : "events above process";
function read() {
  log.push("read " + typeof crypto.createHash);
}
process.nextTick(() => {
  log.push("tick", above());
  Promise.resolve().then(() => log.push("job"));
  process.nextTick(() => log.push("tick 2"));
  read();
  queueMicrotask(() => log.push("microtask"));
  process.nextTick(() => log.push("tick behind the read"));
});
setImmediate(() => console.log(log.join(", ")));
log.push("body");
