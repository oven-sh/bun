// Modules in an import cycle read each other's constants while those are still in their temporal dead zone.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import { seen, readLater } from "./files/a";
import { late } from "./files/b";
import { before, after, inAFunction } from "./files/own";
import cjs from "./files/cjs.cjs";
import { early, later } from "./files/conditions";
import { first } from "./files/cycle_a";
import { later as laterInTheCycle } from "./files/cycle_b";
console.log(seen); console.log(late(), readLater());
console.log(before, after, cjs.before, cjs.after, inAFunction);
console.log(early); console.log(later);
console.log(first, laterInTheCycle());
