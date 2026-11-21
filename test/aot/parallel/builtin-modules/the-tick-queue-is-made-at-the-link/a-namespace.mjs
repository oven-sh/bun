// A namespace of node:fs that nothing reads loads the module at the link: the first tick of the entry runs behind its promise jobs.
import * as fs from "node:fs";
const log = [];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("job"));
queueMicrotask(() => log.push("microtask"));
setImmediate(() => console.log(log.join(", ")));
log.push("body");
