import { unit } from "./index.mjs";
export let count = 0;
export function bump() { count++; return unit; }
