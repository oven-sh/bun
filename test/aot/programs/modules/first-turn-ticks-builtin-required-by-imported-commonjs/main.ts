// The entry point imports a CommonJS file that requires node:fs. An imported CommonJS file is evaluated at link, in import order, so node:fs is no part of the graph of ES modules, and in the first turn of the entry point process.nextTick callbacks run ahead of promise jobs. Plain Bun's order there is not fixed, so the output is stored.
import required from "./requires-builtin.cjs";
const log: string[] = [required.kind];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => console.log(log.join(", ")));
