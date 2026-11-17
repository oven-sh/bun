import { value as inner } from "./inner.js";
globalThis.bodies.push("dep");
export const value = "dep " + inner;
