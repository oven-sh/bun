// two variables, and the one call passes a constant
import type { int32 } from "bun";
function f(to: int32): int32 { let j: int32 = 0; for (let i: int32 = 0; i < to; i++) if (j < i) j++; return j; }
console.log(f(7));
