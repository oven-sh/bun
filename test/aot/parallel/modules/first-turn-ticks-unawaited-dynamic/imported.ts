import { Readable } from "node:stream";
const log: string[] = ["imported", typeof Readable];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => console.log(log.join(", ")));
export {};
