import type { int32 } from "bun";
class Box { maybe?: int32; }
function f(box: Box): int32 { const got = box.maybe!; return Math.max(got, 0); }
let a = 0, b = 0, c = 0, d = 0;
for (let i = 0; i < 300; i++) { const x: int32 = f(new Box()); if (x < 1) a++; if (x >= 0) b++; if (x === x) c++; if (x == 0) d++; }
console.log("SAID", a, b, c, d, Number.isNaN(f(new Box())), Object.is(f(new Box()), NaN));
/* Build errors:
error: TS100031: The return value of 'f' is declared 'int32', but 'Math.max(got, 0)' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'Math.max(got, 0) | 0'.
*/
