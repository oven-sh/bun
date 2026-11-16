import type { int32 } from "bun";
class Box { maybe?: int32; }
function f(box: Box): int32 { const got = box.maybe!; return got; }
const list: number[] = [10, 20, 30];
let sum = 0;
for (let i = 0; i < 200; i++) { const at: int32 = f(new Box()); sum += list[at] ?? 1; }
console.log("SAID", sum, f(new Box()));
