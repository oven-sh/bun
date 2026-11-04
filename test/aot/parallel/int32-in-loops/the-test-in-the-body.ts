// the test in the body
import type { int32 } from "bun";
function g(list: number[]): int32 { let n: int32 = 0; for (const v of list) if (v > 0 && n < 1000) n++; return n; }
function f(a: int32): int32 { return g([a, 1, -1, a]); }
(globalThis as any).kept = [f];
const said: unknown[] = [];
for (const g of (globalThis as any).kept) for (const v of [-2147483648, -5, -1, 0, 1, 2, 3, 7, 40]) said.push(g(v));
console.log(said.join(" "));
