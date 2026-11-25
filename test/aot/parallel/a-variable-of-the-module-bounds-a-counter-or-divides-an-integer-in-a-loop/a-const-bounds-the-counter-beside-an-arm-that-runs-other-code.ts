// STATISTIC: VariableLoopBoundsHoisted >= 2
class Box { constructor(public v: number) {} }
const N = Number(process.argv[2] ?? "12"); let seen = 0; const trap: any = {};
Object.defineProperty(trap, "v", { get() { seen += 100; return 1; } });
function run(boxes: Box[]): string { const k = boxes[0]; let sum = 0, hits = 0; for (let i = 0; i < N; i++) { seen++; sum += i & 7; if (boxes[i & 3].v === k.v) hits++; } return sum + " " + hits; }
function row(): number { let s = 0; for (let i = 0; i < N; i++) s += i & 7; return s; }
console.log(run([new Box(1), new Box(2), trap, new Box(3)]), seen, N, row());
