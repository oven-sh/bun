// node:zlib makes the tick queue of the process while it loads, at the link: with an import of it that nothing reads, the first tick of the entry runs behind its promise jobs.
import zlib from "node:zlib";
const log = [];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("job"));
queueMicrotask(() => log.push("microtask"));
setImmediate(() => console.log(log.join(", ")));
log.push("body");
