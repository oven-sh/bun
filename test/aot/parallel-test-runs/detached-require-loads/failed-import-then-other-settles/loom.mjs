import { thread as one } from "./spool.mjs";
import { thread } from "./bobbin.mjs";
console.log("the loom runs over", one, thread);
export const label = "loom " + one + thread;
