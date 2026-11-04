import { isMainThread } from "node:worker_threads";
import "./b.mjs";
console.log("a runs" + (isMainThread ? "" : " in the worker"));
