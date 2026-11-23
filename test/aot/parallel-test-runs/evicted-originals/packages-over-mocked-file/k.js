import { y } from "./below.js";
globalThis.runs = (globalThis.runs ?? 0) + 1;
export const x = "k" + globalThis.runs + " " + y;
