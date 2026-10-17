import { join } from "node:path";
import { existsSync } from "node:fs";
const log: string[] = ["second", typeof existsSync, typeof join];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
export const order = new Promise<string[]>(resolve => setImmediate(() => resolve(log)));
