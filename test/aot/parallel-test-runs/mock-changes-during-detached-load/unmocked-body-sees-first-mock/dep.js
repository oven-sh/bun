import { value as inner } from "./inner.js";
globalThis.bodies.push("dep:" + inner);
export const value = "dep " + inner;
