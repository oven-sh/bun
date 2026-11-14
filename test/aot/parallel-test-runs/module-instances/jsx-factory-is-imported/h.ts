import { word } from "./config.ts";
globalThis.runtimes = (globalThis.runtimes ?? 0) + 1;
const own = globalThis.runtimes;
export const Frag = "F" + own;
export const h = (tag, props, ...kids) => ({ toString: () => tag + ":" + word + own });
