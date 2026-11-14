import type { int32 } from "bun";
class Box { loose: any = JSON.parse("1.5"); }
function f(box: Box): int32 { const got = box.loose as int32; return Math.max(got, 0); }
const list: number[] = [10, 20, 30];
let sum = 0;
for (let i = 0; i < 200; i++) { const at: int32 = f(new Box()); sum += list[at] ?? 1; }
console.log("SAID", sum, f(new Box()));
/* Build errors:
error: TS100031: This expression is declared 'int32', but 'box.loose' might not be an int32: its type is 'any'. Write 'box.loose | 0'.
*/
