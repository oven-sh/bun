// JSON.parse<T> in four Workers at once and on the main thread: nesting to the end of each thread's own stack, and records that are compared with their texts. start.ts is the program; this file is what each Worker runs.
import { parentPort, workerData } from "node:worker_threads";
import { work } from "./work";

parentPort!.postMessage(work(workerData));
