// A file that an import() loads has an import of node:fs that nothing reads: the link of that file makes the tick queue, and the first tick of the entry runs behind its promise jobs.
const late = await import("./late.mjs");
const log = [];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("job"));
queueMicrotask(() => log.push("microtask"));
setImmediate(() => console.log(log.join(", "), late.kind));
log.push("body");
