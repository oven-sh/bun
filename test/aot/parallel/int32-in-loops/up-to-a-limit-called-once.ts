// up to a limit, and the one call passes a constant
import type { int32 } from "bun";
function f(to: int32): int32 { let n: int32 = 0; for (let i: int32 = 0; i < to; i++) n = i; return n; }
console.log(f(7));
