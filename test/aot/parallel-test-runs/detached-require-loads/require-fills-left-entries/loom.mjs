import { thread } from "./spool.mjs";
console.log("the body of loom runs over", thread);
export const label = "loom " + thread;
