import { other } from "./other.mjs";
export function peek() { return value; }
globalThis.reader = { peek };
if (globalThis.fail) throw new Error("early");
export let value = other + 10;
export let count = 100;
