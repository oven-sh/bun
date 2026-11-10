// STATISTIC: HeadsThatAskBoundInVariable >= 2
class Box { constructor(public v: number) {} }
let bound = 0, seen = 0, target = 0;
const trap: any = {};
Object.defineProperty(trap, "v", { get() { bound = target; return 1; } });
const boxes: Box[] = [new Box(1), new Box(2), trap, new Box(3)];
function run(boxes: Box[]): string { const k = boxes[0]; let a = 0, h = 0, c = 0; for (let i = 0; i < bound; i++) a += i & 7; for (let i = 0; i < bound; i++) { seen++; if (boxes[i & 3].v === k.v) h++; } for (let i = 0; i < bound; i++) c += i & 7; return a + " " + h + " " + c; }
for (const [from, to] of [[12, 5], [3, 7], [12, 2.5]]) { bound = from; target = to; seen = 0; const told = run(boxes); console.log(told, seen, bound); }
