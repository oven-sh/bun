// main.mjs starts this file as a Worker.
import { isMainThread } from "node:worker_threads";
if (!isMainThread) postMessage("job.mjs answers");
