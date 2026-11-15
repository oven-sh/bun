// Flags: --react-compiler
// import.meta.main inside a function that the React Compiler writes anew, in the main thread and in a worker.
import { Worker } from "node:worker_threads";
import { say } from "./say.js";

function kind(list) { "use memo"; return list.map(item => item + (import.meta.main ? " main" : " not main")).join(); }
console.log(kind(["the entry point:"]), say(["a module:"]));
const worker = new Worker(new URL("./worker.js", import.meta.url));
worker.once("message", message => console.log(message));
