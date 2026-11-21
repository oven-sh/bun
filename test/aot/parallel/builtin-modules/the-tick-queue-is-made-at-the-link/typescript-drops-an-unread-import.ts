// A TypeScript file drops an import that nothing reads, so node:fs is not loaded: the first tick of the entry runs before its promise jobs.
import fs from "node:fs";
const log: string[] = [];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("job"));
queueMicrotask(() => log.push("microtask"));
setImmediate(() => console.log(log.join(", ")));
log.push("body");
