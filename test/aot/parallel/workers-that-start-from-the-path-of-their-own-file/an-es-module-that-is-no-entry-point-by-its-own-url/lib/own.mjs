import * as threads from "node:worker_threads";
import { fileURLToPath } from "node:url";
export const byPath = () => new threads.Worker(fileURLToPath(import.meta.url));
export const byUrl = () => new threads.Worker(new URL(import.meta.url));
if (!threads.isMainThread) threads.parentPort.postMessage("the file itself answers");
