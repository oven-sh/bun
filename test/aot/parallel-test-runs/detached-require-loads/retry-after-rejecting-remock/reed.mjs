import { thread } from "./spool.mjs";
globalThis.said?.push("reed over " + thread);
export const label = "reed " + thread;
