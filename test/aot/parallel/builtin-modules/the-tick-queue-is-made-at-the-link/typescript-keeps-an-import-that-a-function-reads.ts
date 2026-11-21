// A TypeScript file keeps an import that a function reads which nobody calls, so node:fs is loaded at the link: the first tick of the entry runs behind its promise jobs.
import fs from "node:fs";
const log: string[] = [];
function neverCalled() {
  return fs.readFileSync;
}
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("job"));
queueMicrotask(() => log.push("microtask"));
setImmediate(() => console.log(log.join(", "), typeof neverCalled));
log.push("body");
