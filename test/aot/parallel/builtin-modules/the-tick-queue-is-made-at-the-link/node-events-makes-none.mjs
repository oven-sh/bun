// node:events makes no tick queue while it loads: with an import of it that nothing reads, the first tick of the entry runs before its promise jobs.
import events from "node:events";
const log = [];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("job"));
queueMicrotask(() => log.push("microtask"));
setImmediate(() => console.log(log.join(", ")));
log.push("body");
