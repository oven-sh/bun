// the limit is a field, and the one call passes a constant
import type { int32 } from "bun";
class Held { limit: int32 = 0; }
function g(held: Held): int32 { let i: int32 = 0; while (held.limit > i) i++; return i; }
function f(a: int32): int32 { const held = new Held(); held.limit = a; return g(held); }
console.log(f(7));
