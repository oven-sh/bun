// Constants read in their dead zones across modules: in cycles, in conditions, and from a CommonJS file.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import { seen, readLater } from "./a";
import { late } from "./b";
import { before, after, inAFunction } from "./own";
import cjs from "./cjs.cjs";
import { early, later } from "./conditions";
import { first } from "./cycle_a";
import { later as laterInTheCycle } from "./cycle_b";
console.log(seen); console.log(late(), readLater());
console.log(before, after, cjs.before, cjs.after, inAFunction);
console.log(early); console.log(later);
console.log(first, laterInTheCycle());
