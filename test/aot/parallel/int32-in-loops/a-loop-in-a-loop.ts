// a loop in a loop
import type { int32 } from "bun";
function f(to: int32): int32 { let n: int32 = 0; for (let i: int32 = 0; i < to; i++) for (let j: int32 = 0; j < i; j++) n = (n + j) | 0; return n; }
(globalThis as any).kept = [f];
const said: unknown[] = [];
for (const g of (globalThis as any).kept) for (const v of [-2147483648, -5, -1, 0, 1, 2, 3, 7, 40]) said.push(g(v));
console.log(said.join(" "));
