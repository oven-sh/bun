import { existsSync } from "node:fs";
const log: string[] = ["imported in the worker", typeof existsSync];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => postMessage(log.join(", ")));
export {};
