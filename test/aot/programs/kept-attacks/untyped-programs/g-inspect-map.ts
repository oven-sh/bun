// Untyped programs: g inspect map. It prints what plain Bun prints.
import { inspect } from "node:util";
console.log(inspect(new Map([[1, 2]])), inspect(new Set([1])));
