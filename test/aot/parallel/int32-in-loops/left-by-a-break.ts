// left by a break
import type { int32 } from "bun";
function f(to: int32): int32 { let i: int32 = 0; for (;;) { if (i >= to) break; i++; } return i; }
(globalThis as any).kept = [f];
const said: unknown[] = [];
for (const g of (globalThis as any).kept) for (const v of [-2147483648, -5, -1, 0, 1, 2, 3, 7, 40]) said.push(g(v));
console.log(said.join(" "));
