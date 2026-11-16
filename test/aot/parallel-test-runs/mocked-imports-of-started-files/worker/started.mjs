import { Worker } from "node:worker_threads";
import { read } from "./mocked.mjs";
export const started = () => "started " + read();
export const start = () => new Worker(new URL("./started.mjs", import.meta.url));
console.log("SAID started ran", read());
