// Each thread's first JSON.parse finds that thread's caches of names and strings empty, and finds them emptied of strings after a collection. start.ts is the program.
import { parentPort, workerData } from "node:worker_threads";
import { describe } from "./parse";

parentPort!.postMessage(describe("worker " + workerData));
