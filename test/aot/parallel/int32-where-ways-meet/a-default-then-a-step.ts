// a default then a step
import type { int32 } from "bun";
function g(a: int32 | undefined): int32 { const b = a ?? 0; return b < 100 ? b + 1 : b; }
function f(a: int32): int32 { return g(a & 1 ? a : undefined); }
(globalThis as any).kept = [f];
const said: unknown[] = [];
for (const g of (globalThis as any).kept) for (const v of [-2147483648, -2147483647, -1001, -1000, -101, -100, -1, 0, 1, 2, 3, 99, 100, 255, 256, 999, 1000, 1001, 2147483646, 2147483647]) said.push(g(v));
console.log(said.join(" "));
