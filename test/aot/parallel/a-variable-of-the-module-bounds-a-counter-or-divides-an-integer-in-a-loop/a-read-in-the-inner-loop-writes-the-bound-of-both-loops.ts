// STATISTIC: InvariantNumberGuardsHoisted >= 1
class Box { constructor(public v: number) {} }
let bound = 0, seen = 0, target = 0;
const trap: any = {};
Object.defineProperty(trap, "v", { get() { bound = target; return 1; } });
const boxes: Box[] = [new Box(1), new Box(2), trap, new Box(3)];
function run(boxes: Box[]): string { const k = boxes[0]; let hits = 0; for (let i = 0; i < bound; i++) { seen += i & 7; for (let j = 0; j < bound; j++) { seen++; if (boxes[j & 3].v === k.v) hits++; } } return hits + ""; }
for (const [from, to] of [[3, 2], [3, 5], [3, 1.5]]) { bound = from; target = to; seen = 0; const told = run(boxes); console.log(told, seen, bound); }
