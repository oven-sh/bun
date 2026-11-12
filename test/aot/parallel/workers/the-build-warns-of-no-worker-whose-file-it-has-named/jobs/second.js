// a-name-in-part/main.js starts this file as a Worker. Run as a program it has no parent.
import { isMainThread } from "node:worker_threads";
if (isMainThread) console.log("no parent");
else postMessage("jobs/second.js answers");
