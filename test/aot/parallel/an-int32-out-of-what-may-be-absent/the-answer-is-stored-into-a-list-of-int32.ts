import type { int32 } from "bun";
class Box { maybe?: int32; }
function f(box: Box): int32 { const got = box.maybe!; return Math.max(got, 0); }
const list: int32[] = [];
for (let i = 0; i < 300; i++) list.push(f(new Box()));
let n = 0; for (const x of list) if (x !== x) n++;
console.log("SAID", list.length, n, list[0], list[299], typeof list[5], JSON.stringify(list.slice(0, 3)));
/* Build errors:
error: TS100031: The return value of 'f' is declared 'int32', but 'Math.max(got, 0)' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'Math.max(got, 0) | 0'.
*/
