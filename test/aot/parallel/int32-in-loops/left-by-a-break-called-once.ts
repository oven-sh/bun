// left by a break, and the one call passes a constant
import type { int32 } from "bun";
function f(to: int32): int32 { let i: int32 = 0; for (;;) { if (i >= to) break; i++; } return i; }
console.log(f(7));
