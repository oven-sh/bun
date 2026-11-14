// Spreads, rests and lists of literals that declare accessors: each getter runs once, in the order of the keys, and what it does to the object is seen by the keys behind it alone.
const lines = [];
let log = [];
const tell = (o) => Reflect.ownKeys(o).map((k) => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + String(d.value) : "<" + !!d.get + "|" + !!d.set + ">") + (d.enumerable ? "" : "h"); }).join(" ");
const attempt = (f) => { try { return f(); } catch (e) { return e.message; } };
let reads = 0;

function pair(width, height) { return { width, get area() { log.push("area"); return this.width * height; }, set area(v) { this.width = v / height; } }; }
function middle(n) { return { a: n, get b() { log.push("b"); return ++reads; }, c: n + 1, get d() { log.push("d"); return this.a + this.c; } }; }
function counts(n) { return { get first() { return reads; }, get second() { return ++reads; }, get third() { return reads + n; } }; }
function deletes(n) { return { get a() { delete this.c; return n; }, b: 1, c: 2 }; }
function hides(n) { return { get a() { Object.defineProperty(this, "c", { enumerable: false }); return n; }, b: 1, c: 2 }; }
function adds(n) { return { get a() { this.z = n; return 1; }, b: 2 }; }
function throws(n) { return { x: 1, get a() { if (n > 1) throw new Error("a" + n); return n; }, get b() { log.push("b"); return 2; } }; }
function stores(n) { return { get a() { this.b = n * 10; return n; }, b: 1 }; }
function setter(n) { return { set a(v) { log.push(v); }, b: n }; }
function redefines(n) { return { get a() { Object.defineProperty(this, "b", { get() { return "late" + n; }, enumerable: true, configurable: true }); return n; }, b: 1, get c() { return 3; } }; }

const makers = { pair: (n) => pair(n, 3), middle, counts, deletes, hides, adds, throws, stores, setter, redefines };
const ways = {
  spread: (make, n) => tell({ ...make(n) }),
  before: (make, n) => tell({ c: 0, ...make(n), z: reads }),
  behind: (make, n) => { const o = make(n); return tell({ ...o, reads, a: log.length }); },
  twice: (make, n) => { const o = make(n); return tell({ ...o, ...o }); },
  rest: (make, n) => { const { b, ...rest } = make(n); return tell(rest) + " " + b; },
  none: (make, n) => { const { ...rest } = make(n); return tell(rest); },
  values: (make, n) => Object.values(make(n)).join(),
  entries: (make, n) => Object.entries(make(n)).join(),
  keys: (make, n) => Object.keys(make(n)).join() + Object.getOwnPropertyNames(make(n)).join() + Reflect.ownKeys(make(n)).length,
  assign: (make, n) => tell(Object.assign({}, make(n), { q: reads })),
  source: (make, n) => { const o = make(n); const copy = { ...o }; return tell(o) + " | " + tell(copy); },
  loop: (make, n) => { let t = ""; for (let i = 0; i < 3; i++) { const o = make(n + i); const copy = { i, ...o }; t += tell(copy) + ";"; } return t; },
};
for (const [name, make] of Object.entries(makers))
  for (const [way, use] of Object.entries(ways))
    for (const n of [1, 2]) { log = []; lines.push(name + " " + way + " " + n + ": " + attempt(() => use(make, n)) + " [" + log.join() + "] " + reads); }

// Each literal in sight of its copy.
function inSight(width, height) {
  const shape = { width, get area() { log.push("s"); return this.width * height; }, set area(v) { this.width = v / height; } };
  const copy = { ...shape };
  shape.area = 60;
  const { width: w, ...rest } = shape;
  return [shape.width, shape.area, copy.area, copy.width, w, tell(rest), typeof Object.getOwnPropertyDescriptor(copy, "area").get].join();
}
function inSightThatDeletes(n) {
  const o = { get a() { delete o.b; return n; }, b: 1, c: 2 };
  const copy = { ...o };
  return tell(copy) + " " + tell(o);
}
function inSightThatStores(n) {
  const o = { get a() { o.b = n; return 1; }, b: 0, get c() { return o.b + 1; } };
  return tell({ ...o, d: o.b });
}
for (let n = 1; n < 5; n++) { log = []; lines.push(inSight(n, 3) + log.join(), inSightThatDeletes(n), inSightThatStores(n)); }
const table = Object.freeze({ base: 10, get next() { return this.base + ++reads; }, apply(call, ...rest) { return call.call(this, ...rest); } });
function run(n) { const taken = { ...table }; return [table.apply(function (a, b) { return this.base * a + b; }, n, table.next), taken.next, typeof taken.next, reads, Object.keys(table).join("+"), Object.values(table).length].join(); }
for (let n = 0; n < 4; n++) lines.push(run(n));
console.log(lines.join("\n"));
