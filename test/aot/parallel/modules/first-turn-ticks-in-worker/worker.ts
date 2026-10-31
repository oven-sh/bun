// The entry point of a Worker imports node:fs: its first turn has the order of the main thread's. The build lists main.ts first, so the main thread runs that and starts this file as a Worker.
import { existsSync } from "node:fs";
import { parentPort } from "node:worker_threads";
const log: string[] = ["worker", typeof existsSync];
process.nextTick(() => log.push("tick"));
Promise.resolve().then(() => log.push("promise job"));
setImmediate(() => parentPort!.postMessage(log.join(", ")));
