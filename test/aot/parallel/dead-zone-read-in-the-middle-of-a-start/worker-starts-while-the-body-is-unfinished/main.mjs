import { Worker } from "node:worker_threads";
function read() { try { return late.rate; } catch (error) { return error.name; } }
let seen = "not run";
const worker = new Worker(new URL("./job.mjs", import.meta.url));
worker.on("message", () => { seen = read(); });
await new Promise(resolve => worker.on("exit", resolve));
const late = { rate: 0.2 };
console.log(seen, read());
