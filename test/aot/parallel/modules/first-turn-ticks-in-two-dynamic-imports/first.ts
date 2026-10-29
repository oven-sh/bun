import { existsSync } from "node:fs";
import { join } from "node:path";
const log: string[] = ["first", typeof existsSync, typeof join];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
export const order = new Promise<string[]>(resolve => setImmediate(() => resolve(log)));
