let calls = 0;
class Gauge {
  c: number;
  constructor(c: number) { this.c = c; }
  get f(): number { calls = calls + 1; return this.c; }
}
class Pair { a: number; constructor(a: number) { this.a = a; } }
const unseen = (x: any) => [x][JSON.parse("0")];
function run(o: any, n: number, list: Pair[], depth: number): number {
  if (depth > 0) return run(o, n, list, depth - 1);
  let last = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { last = o.f; const b = list[i & 1]; sum = sum + b.a; calls = calls + 1; }
  return last + sum;
}
const first = new Gauge(3);
(globalThis as any).keptGauge = first;
const pairs = [new Pair(1), new Pair(2)];
let total = 0;
for (let r = 0; r < 300; r++) total = (total + run(unseen(first), 7, pairs, r % 3)) | 0;
console.log(total, calls);
