import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
const log: string[] = ["third", typeof existsSync, typeof join, typeof Readable];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
export const order = new Promise<string[]>(resolve => setImmediate(() => resolve(log)));
