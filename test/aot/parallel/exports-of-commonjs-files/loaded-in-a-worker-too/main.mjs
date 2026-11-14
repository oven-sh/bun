// a Worker loads the same CommonJS files in a realm of its own and passes texts there
// Under: --aot-testing=CheckProofsAtRunTime: what a read of the exports variable finds is held against what Link says of it
import { Worker } from "node:worker_threads";
import "./start.cjs";
const worker = new Worker(new URL("./worker.cjs", import.meta.url));
worker.on("message", text => { console.log(text); worker.terminate(); });
