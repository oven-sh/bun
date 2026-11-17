import { word } from "./config.mjs";
globalThis.runtimes = (globalThis.runtimes ?? 0) + 1;
const own = globalThis.runtimes;
export const Fragment = "F" + own;
const make = (tag, props) => ({ toString: () => tag + ":" + word + own });
export const jsx = make, jsxs = make, jsxDEV = make;
export const createElement = (tag, props, ...kids) => ({ toString: () => tag + ":" + word + own + "c" });
