// In the first turn of an ES module that imports node:fs, promise jobs run ahead of process.nextTick callbacks, as in plain Bun and Node: node:fs is loaded before the module is evaluated.
import { existsSync } from "node:fs";
const log: string[] = [typeof existsSync];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => console.log(log.join(", ")));
