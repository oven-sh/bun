import { thread } from "./spool.mjs";
globalThis.said?.push("shuttle over " + thread);
export const label = "shuttle " + thread;
