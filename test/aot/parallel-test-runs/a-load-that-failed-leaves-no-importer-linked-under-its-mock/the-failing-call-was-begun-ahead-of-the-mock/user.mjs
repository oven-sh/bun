import { who } from "./dep.mjs";
globalThis.ran = (globalThis.ran ?? "") + "u";
let count = 0;
export const read = () => who;
export const step = () => ++count;
