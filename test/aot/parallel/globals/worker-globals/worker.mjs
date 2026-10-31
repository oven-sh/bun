import { parentPort } from "node:worker_threads";
import { kind, read, store } from "./shared.mjs";
const told = [kind()];
try {
  told.push(read());
} catch (error) {
  told.push(error.name + ": " + error.message);
}
globalThis.place = "worker";
told.push(read(), read());
store("stored in the worker");
told.push(read(), globalThis.place);
parentPort.postMessage(told.join());
