// if and else into a variable
import type { int32 } from "bun";
function f(a: int32): int32 { let r: int32; if (a < 2147483647) r = a + 1; else r = a; return r; }
(globalThis as any).kept = [f];
const said: unknown[] = [];
for (const g of (globalThis as any).kept) for (const v of [-2147483648, -2147483647, -1001, -1000, -101, -100, -1, 0, 1, 2, 3, 99, 100, 255, 256, 999, 1000, 1001, 2147483646, 2147483647]) said.push(g(v));
console.log(said.join(" "));
