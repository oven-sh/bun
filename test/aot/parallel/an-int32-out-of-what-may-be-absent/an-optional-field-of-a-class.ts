import type { int32 } from "bun";
class Box { maybe?: int32; }
function f(box: Box): int32 { const got = box.maybe!; return Math.max(got, 0); }
const list: number[] = [10, 20, 30];
let sum = 0;
for (let i = 0; i < 200; i++) { const at: int32 = f(new Box()); sum += list[at] ?? 1; }
console.log("SAID", sum, f(new Box()));
/* Build errors:
error: TS100031: The return value of 'f' is declared 'int32', but 'Math.max(got, 0)' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'Math.max(got, 0) | 0'.
*/
