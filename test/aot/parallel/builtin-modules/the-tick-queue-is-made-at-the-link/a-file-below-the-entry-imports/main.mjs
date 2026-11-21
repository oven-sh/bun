// A file that the entry imports has an import of node:fs that nothing reads: the module is loaded at the link of the graph, and the first tick of the entry runs behind its promise jobs.
import { kind } from "./below.mjs";
const log = [];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("job"));
queueMicrotask(() => log.push("microtask"));
setImmediate(() => console.log(log.join(", "), kind));
log.push("body");
