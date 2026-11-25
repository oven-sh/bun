import { parentPort } from "node:worker_threads";
parentPort.postMessage("inner.js beside the entry point");
