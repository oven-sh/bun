import type { int32 } from "bun";
class Box { maybe?: int32; }
function f(box: Box): int32 { const got = box.maybe!; return Math.max(got, 0); }
class Kept { at: int32 = 0; next: Kept | null = null; }
let head: Kept | null = null;
for (let i = 0; i < 300; i++) { const k = new Kept(); k.at = f(new Box()); k.next = head; head = k; }
let n = 0, s = 0; for (let k = head; k; k = k.next) { n++; s += k.at; }
console.log("SAID", n, s, head!.at, String(head!.at), [1, 2, 3][head!.at]);
/* Build errors:
error: TS100031: The return value of 'f' is declared 'int32', but 'Math.max(got, 0)' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'Math.max(got, 0) | 0'.
*/
