// a loop in a loop, and the one call passes a constant
import type { int32 } from "bun";
function f(to: int32): int32 { let n: int32 = 0; for (let i: int32 = 0; i < to; i++) for (let j: int32 = 0; j < i; j++) n = (n + j) | 0; return n; }
console.log(f(7));
