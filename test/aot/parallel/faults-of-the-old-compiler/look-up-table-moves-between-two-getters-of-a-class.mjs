// Two getters of a class are read in a loop, and between them a property of a function that has one of 4,096 shapes: the table in which lookups by name are filed grows and moves while the loop runs.
const K = Number(process.argv[2] ?? 1500);
function classOf(step) {
  return class Pair {
    constructor(a, b) { this.first = a; this.second = b; }
    get low() { return this.first + step; }
    get high() { return this.second + step; }
  };
}
const Pair = classOf(Number(process.argv[3] ?? 1));
const records = [];
for (let i = 0; i < K; i++) records.push(JSON.parse('{"id":' + i + ',"tag_' + i + '":true,"f0":0,"f1":1,"f2":2,"f3":3,"f4":4,"f5":5,"f6":6,"f7":7,"f8":8,"f9":9}'));
function make(i) { const h = (x) => x + i; if (i & 1) h.once = true; if (i & 2) h.priority = i; if (i & 4) h.group = "g"; if (i & 8) h.label = "l"; if (i & 16) h.muted = false; if (i & 32) h.weight = 2; if (i & 64) h.scope = 1; if (i & 128) h.order = 2; if (i & 256) h.kind = 3; if (i & 512) h.owner = 4; if (i & 1024) h.since = 5; if (i & 2048) h.until = 6; return h; }
const handlers = []; for (let i = 0; i < 4096; i++) handlers.push(make(i));
function warm(rows) { let n = 0; for (let i = 0; i < rows.length; i++) { const r = rows[i]; n += r.f0 + r.f1 + r.f2 + r.f3 + r.f4 + r.f5 + r.f6 + r.f7 + r.f8 + r.f9; } return n; }
function scan(pair, rows, hs, off) {
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const low = pair.low, p = hs[(i + off) & 4095].priority, s = rows[i].f0, high = pair.high;
    n += low + high + s + (p === undefined ? 0 : p);
  }
  return n;
}
let last = 0;
const pair = new Pair(1, 2);
for (let pass = 0; pass < 40; pass++) last += warm(records);
for (let pass = 0; pass < 400; pass++) last += scan(pair, records, handlers, pass * 37);
console.log(last);
