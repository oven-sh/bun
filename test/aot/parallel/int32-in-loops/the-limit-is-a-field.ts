// the limit is a field
import type { int32 } from "bun";
class Held { limit: int32 = 0; }
function g(held: Held): int32 { let i: int32 = 0; while (held.limit > i) i++; return i; }
function f(a: int32): int32 { const held = new Held(); held.limit = a; return g(held); }
(globalThis as any).kept = [f];
const said: unknown[] = [];
for (const g of (globalThis as any).kept) for (const v of [-2147483648, -5, -1, 0, 1, 2, 3, 7, 40]) said.push(g(v));
console.log(said.join(" "));
