import { other } from "./other.mjs";
import { early } from "./b.mjs";
globalThis.say("a runs");
export let value = other + 10;
export let count = 100;
export function add(n) { value += n; return value; }
export const earlier = early;
