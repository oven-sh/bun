import { parentPort } from "node:worker_threads";
import { say } from "./say.js";

function kind(list) { "use memo"; return list.map(item => item + (import.meta.main ? " main" : " not main")).join(); }
parentPort.postMessage(kind(["the worker:"]) + " " + say(["a module:"]));
