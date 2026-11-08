let calls = 0;
let other = 0;
class Gauge {
    constructor(c) { this.c = c; }
  get f() { calls = calls + 1; return this.c; }
}
class Pair { constructor(a) { this.a = a; } }
const unseen = (0, eval)("(x) => x");
const pairs = [new Pair(1), new Pair(2)];
function run(o, n, list, depth) {
  if (depth > 0) return run(o, n, list, depth - 1);
  let last = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { last = o.f; const b = list[i & 1]; sum = sum + b.a; calls = calls + 1; }
  return last + sum;
}
const first = new Gauge(3);
globalThis.keptGauge = first;
let total = 0;
for (let r = 0; r < 300; r++) total = (total + run(unseen(first), 7, pairs, r % 3)) | 0;
console.log(total, calls, other, pairs.length, pairs[0].a, pairs[1].a);
