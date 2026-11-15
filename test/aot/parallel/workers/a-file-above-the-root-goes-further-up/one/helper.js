// one/two/jobs/two-up.js starts this file as a Worker. Run as a program it has no parent.
import { parentPort } from "node:worker_threads";
if (parentPort) parentPort.postMessage("the helper.js two folders above the job");
else console.log("no parent");
