// over a text, and the one call passes a constant
import type { int32 } from "bun";
function g(text: string): int32 { let n: int32 = 0; for (let i: int32 = 0; i < text.length; i++) n = i; return n; }
function f(a: int32): int32 { return g("x".repeat(a > 0 ? a : 0)); }
console.log(f(7));
