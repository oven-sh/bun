// Names of CommonJS files that an ES module imports, against stores that come later.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import { seenByRequire } from "./first.cjs";
import { n, bump, add } from "./live.cjs";
import * as ns from "./live.cjs";
import whole from "./live.cjs";
console.log("at the start", seenByRequire, n, ns.n, whole.n);
bump();
console.log("after a store", n, ns.n, whole.n);
add();
console.log("after a new name", String(ns.added), String(whole.added), Object.keys(ns).sort().join());
const again = await import("./live.cjs");
console.log("import()", again.n, again === ns);
