// A barrel and a literal, read by an ES module and by a CommonJS file.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import { a, b } from "./barrel.js";
import { viaRequire } from "./user.cjs";
console.log(a, b, viaRequire());
