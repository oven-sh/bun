import { existsSync } from "node:fs";
const log: string[] = ["imported", typeof existsSync];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => console.log(log.join(", ")));
export {};
