import { parentPort } from "node:worker_threads";
parentPort.postMessage("the helper.js beside the entry point");
