import type { int32 } from "bun";
class Box { maybe?: int32; }
function f(box: Box): int32 { const got = box.maybe!; return Math.max(got, 0); }
function g(box: Box): int32 { const a: int32 = f(box); return (a + 1) | 0; }
function h(box: Box): number { const a: int32 = f(box); return a + 1; }
let s = 0, t = 0; for (let i = 0; i < 300; i++) { s += g(new Box()); t += h(new Box()); }
console.log("SAID", s, t, g(new Box()), h(new Box()), f(new Box()) * 2, f(new Box()) - 1, -f(new Box()));
/* Build errors:
error: TS100031: The return value of 'f' is declared 'int32', but 'Math.max(got, 0)' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'Math.max(got, 0) | 0'.
*/
