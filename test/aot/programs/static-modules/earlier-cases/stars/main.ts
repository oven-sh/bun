// TypeScript's `export *` over CommonJS files, read by requirers and by ES importers.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import { report } from "./user.cjs";
import { s, a, fa } from "./forEs.js";
import * as forEs from "./forEs.js";
console.log(report());
console.log(s, a, fa(1), forEs.s, forEs.fa(2));
