let calls = 0;
let other = 0;
class Gauge {
  c: number;
  constructor(c: number) { this.c = c; }
  get f(): number { calls = calls + 1; const held = this.c; if (calls % 5 === 0) { delete (this as any).c; other = other + 1; } else this.c = held === undefined ? 3 : held; return calls; }
}
class Pair { a: number; constructor(a: number) { this.a = a; } }
const unseen: (x: any) => any = (0, eval)("(x) => x");
const pairs = [new Pair(1), new Pair(2)];
function run(o: any, n: number, list: Pair[], depth: number): number {
  if (depth > 0) return run(o, n, list, depth - 1);
  let last = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { last = o.f; sum = sum + (o.c === undefined ? 100 : o.c); const b = list[i & 1]; sum = sum + b.a; calls = calls + 1; }
  return last + sum;
}
const first = new Gauge(3);
(globalThis as any).keptGauge = first;
let total = 0;
for (let r = 0; r < 300; r++) total = (total + run(unseen(first), 7, pairs, r % 3)) | 0;
console.log(total, calls, other, pairs.length, pairs[0].a, pairs[1].a);
