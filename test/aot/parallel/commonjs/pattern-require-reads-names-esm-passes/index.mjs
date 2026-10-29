export { go, n, n as renamed } from "./lib.cjs";
export { default as lib } from "./lib.cjs";
import * as all from "./lib.cjs";
export const keys = Object.keys(all).sort().join();
export const own = "own";
