import type { int32 } from "bun";
class Box { maybe?: int32; }
function f(box: Box): int32 { const got = box.maybe!; return Math.max(got, 0); }
let s = 0; for (let i = 0; i < 300; i++) { const x: int32 = f(new Box()); s += (x << 1) + (x >> 1) + (x & 7) + (x ^ 3) + ~x; }
console.log("SAID", s, `${f(new Box())}`, f(new Box()).toString(), f(new Box()).toFixed(1), Math.abs(f(new Box())), Math.min(f(new Box()), 4));
/* Build errors:
error: TS100031: The return value of 'f' is declared 'int32', but 'Math.max(got, 0)' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'Math.max(got, 0) | 0'.
*/
