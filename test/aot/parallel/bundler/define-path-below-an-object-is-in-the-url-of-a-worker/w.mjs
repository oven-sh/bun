import { parentPort } from "node:worker_threads";
parentPort.postMessage("the worker ran");
