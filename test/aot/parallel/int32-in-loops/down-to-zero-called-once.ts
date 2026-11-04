// down to zero, and the one call passes a constant
import type { int32 } from "bun";
function f(from: int32): int32 { let n: int32 = 5; for (let i: int32 = from; i >= 0; i--) n = i; return n; }
console.log(f(7));
