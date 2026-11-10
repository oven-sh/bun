// STATISTIC: NumbersBesideCountersAskedInFrontOfLoops >= 1
class Box { constructor(public v: number) {} }
var bound = 0, seen = 0, target = 0;
const trap: any = {};
Object.defineProperty(trap, "v", { get() { bound = target; return 1; } });
const boxes: Box[] = [new Box(1), new Box(2), trap, new Box(3)];
function run(boxes: Box[]): string { const k = boxes[0]; let sum = 0, hits = 0; for (let i = 0; i < bound; i++) { seen++; sum += i & 7; if (boxes[i & 3].v === k.v) hits++; } return sum + " " + hits; }
for (const [from, to] of [[12, 5], [3, 7], [12, 2.5]]) { bound = from; target = to; seen = 0; const told = run(boxes); console.log(told, seen, bound); }
