import type { int32 } from "bun";
class Box { maybe?: int32; }
function f(box: Box): int32 { const got = box.maybe!; return Math.max(got, 0); }
const bytes = new Uint8Array([7, 8, 9, 10]);
let sum = 0, none = 0;
for (let i = 0; i < 300; i++) { const at: int32 = f(new Box()); const got = bytes[at]; if (got === undefined) none++; else sum += got; bytes[at] = 5; }
console.log("SAID", sum, none, Array.from(bytes).join());
/* Build errors:
error: TS100031: The return value of 'f' is declared 'int32', but 'Math.max(got, 0)' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'Math.max(got, 0) | 0'.
*/
