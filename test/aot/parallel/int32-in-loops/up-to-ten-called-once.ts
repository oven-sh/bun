// up to ten, and the one call passes a constant
import type { int32 } from "bun";
function f(a: int32): int32 { let n: int32 = a; for (let i: int32 = 0; i < 10; i++) n = i; return n; }
console.log(f(7));
