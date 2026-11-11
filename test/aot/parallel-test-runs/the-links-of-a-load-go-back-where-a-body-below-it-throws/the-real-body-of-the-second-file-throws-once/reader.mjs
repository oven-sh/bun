import { value as one } from "./one.mjs";
import { value as two } from "./two.mjs";
globalThis.runs ??= {};
globalThis.runs.reader = (globalThis.runs.reader || 0) + 1;
export const read = () => one + " | " + two;
