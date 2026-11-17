import type { int32 } from "bun";
class Box { maybe?: int32; }
function clear(box: Box): void { box.maybe = undefined; }
function f(box: Box): int32 { if (box.maybe === undefined) return 0; clear(box); const got = box.maybe; return Math.max(got, 0); }
const full = new Box(); full.maybe = 4;
console.log("SAID", f(full));
/* Build errors:
error: TS100031: The return value of 'f' is declared 'int32', but 'Math.max(got, 0)' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'Math.max(got, 0) | 0'.
*/
