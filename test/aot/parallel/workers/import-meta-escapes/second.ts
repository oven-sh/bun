import { parentPort } from "node:worker_threads";
parentPort!.postMessage("second");
