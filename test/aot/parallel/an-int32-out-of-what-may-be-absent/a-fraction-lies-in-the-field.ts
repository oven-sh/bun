import type { int32 } from "bun";
class Box { maybe?: int32; }
function put(o: any, k: string, v: any) { o[k] = v; }
function f(box: Box): int32 { const got = box.maybe!; return Math.max(got, 0); }
const key: string = JSON.parse('"maybe"'); const bytes = new Uint8Array([7, 8, 9, 10]);
let s = 0; for (let i = 0; i < 300; i++) { const b = new Box(); put(b, key, JSON.parse("1.5")); const at: int32 = f(b); s += at + (bytes[at] ?? 100); }
console.log("SAID", s);
/* Build errors:
error: TS100031: The return value of 'f' is declared 'int32', but 'Math.max(got, 0)' might not be an int32: it is a 'number', which can have a fraction, be out of range, or be NaN or -0. Write 'Math.max(got, 0) | 0'.
*/
