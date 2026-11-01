// ../app/src/main.js starts this file as a Worker. Run as a program it has no parent.
import { parentPort } from "node:worker_threads";
if (parentPort) parentPort.postMessage("jobs/job.js");
else console.log("no parent");
