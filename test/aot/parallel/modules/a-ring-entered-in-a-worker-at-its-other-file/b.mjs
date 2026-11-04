import { isMainThread } from "node:worker_threads";
import "./a.mjs";
console.log("b runs" + (isMainThread ? "" : " in the worker"));
