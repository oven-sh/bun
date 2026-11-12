import { thread } from "./spool.mjs";
console.log("the body of shed runs over", thread);
export const label = "shed " + thread;
