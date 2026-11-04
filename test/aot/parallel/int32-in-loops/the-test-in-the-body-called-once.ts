// the test in the body, and the one call passes a constant
import type { int32 } from "bun";
function g(list: number[]): int32 { let n: int32 = 0; for (const v of list) if (v > 0 && n < 1000) n++; return n; }
function f(a: int32): int32 { return g([a, 1, -1, a]); }
console.log(f(7));
