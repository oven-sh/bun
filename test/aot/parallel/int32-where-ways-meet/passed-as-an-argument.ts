// passed as an argument
import type { int32 } from "bun";
function take(n: int32): int32 { return n; }
function f(a: int32): int32 { return take(a !== 2147483647 ? a + 1 : a); }
(globalThis as any).kept = [f];
const said: unknown[] = [];
for (const g of (globalThis as any).kept) for (const v of [-2147483648, -2147483647, -1001, -1000, -101, -100, -1, 0, 1, 2, 3, 99, 100, 255, 256, 999, 1000, 1001, 2147483646, 2147483647]) said.push(g(v));
console.log(said.join(" "));
