import { parentPort } from "node:worker_threads";
import { describe } from "./shared.mjs";
const before = describe();
process.platform = "made up in the worker";
parentPort.postMessage(before + ", then " + describe());
