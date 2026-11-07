// The programs beside this file start it as a Worker. Run as a program it has no parent.
import { isMainThread } from "node:worker_threads";
if (isMainThread) console.log("no parent");
else postMessage("job.js answers");
