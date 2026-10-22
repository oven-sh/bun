// ES modules that are looked at early: by a listener in a CommonJS file, in a cycle, and below a top-level await.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import "./listener.cjs";
import * as t from "./t";
import { lookAtB } from "./cyc_a";
import { early, late } from "./cyc_b";
console.log(t.first); console.log(t.second); console.log(t.a, t.b);
console.log(early, late(), lookAtB());
const awaits = await import("./awaits");
console.log(awaits.state, awaits.done, Object.keys(awaits).join());
