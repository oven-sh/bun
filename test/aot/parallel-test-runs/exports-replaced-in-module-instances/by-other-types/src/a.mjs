import { other } from "./other.mjs";
export let value = other + 10;
export let count = 100;
export function add(n) { value += n; return value; }
