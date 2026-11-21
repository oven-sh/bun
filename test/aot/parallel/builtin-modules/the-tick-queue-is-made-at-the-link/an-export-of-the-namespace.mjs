// An export of the namespace of node:fs loads the module at the link: the first tick of the entry runs behind its promise jobs.
export * as fs from "node:fs";
const log = [];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("job"));
queueMicrotask(() => log.push("microtask"));
setImmediate(() => console.log(log.join(", ")));
log.push("body");
