// node:fs makes the tick queue at the link, not when its import is first read: with a read at the top of the entry the first tick still runs behind the promise jobs.
import fs from "node:fs";
const kind = typeof fs.readFileSync;
const log = [];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("job"));
queueMicrotask(() => log.push("microtask"));
setImmediate(() => console.log(log.join(", "), kind));
log.push("body");
