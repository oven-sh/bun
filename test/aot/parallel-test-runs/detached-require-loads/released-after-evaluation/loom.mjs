import { thread } from "./spool.mjs";
export const label = "loom " + thread;
export let count = 0;
export const bump = () => ++count;
(globalThis.views ??= []).push(() => label + " " + count);
