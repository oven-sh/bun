// STATISTIC: FieldsFilledBesideDeletions >= 6
// `delete o.x` takes `x` away: the other fields of the class stay where they are.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };

class Point { constructor(x, y) { this.x = x; this.y = y; this.next = null; } sum() { return this.x + this.y; } step(k) { this.x = (this.x + k) & 1023; if (this.next) this.y = this.next.y; return this; } }
function Node(kind, start) { this.kind = kind; this.start = start; this.end = 0; this.operator = "+"; }
Node.prototype.width = function () { return this.end - this.start; };
class Base { constructor(a) { this.a = a; this.b = a + 1; this.c = "c" + a; } total() { return this.a + this.b; } }
class Heir extends Base { constructor(a) { super(a); this.d = a * 2; } total() { return super.total() + this.d; } }
class Open { constructor(a) { this.a = a; this.b = a; this.c = a; } total() { return (this.a === undefined ? 0 : this.a) + (this.b === undefined ? 0 : this.b); } }
class Counter { constructor(n) { this.n = n; this.label = "n"; this.cache = [n]; } bump() { this.n++; return this.n; } }

function hot(n) {
  const list = []; let total = 0;
  for (let i = 0; i < 8; i++) { const p = new Point(i, i + 1); p.next = i ? list[i - 1] : null; list.push(p); }
  for (let k = 0; k < n; k++) { const p = list[k & 7]; total = (total + p.step(k).sum()) | 0; if ((k & 15) === 0) { const q = new Point(k & 255, 3); q.next = p; list[(k >> 4) & 7] = q; if (k & 16) delete q.next; else q.next = null; } }
  return total;
}
tell("hot", () => hot(1000));
tell("deleted", () => { const p = new Point(1, 2); delete p.next; return [Object.keys(p), p.sum(), "next" in p, p.next === undefined, p.step(3).sum()]; });
tell("again", () => { const p = new Point(1, 2); delete p.next; p.next = new Point(5, 6); return [Object.keys(p), p.step(1).sum(), JSON.stringify(p)]; });
tell("order", () => { const p = new Point(1, 2); const other = p; delete other.next; other.next = null; delete other.next; other.extra = 1; other.next = 2; return Object.entries(p); });

const nodes = [];
for (let i = 0; i < 6; i++) { const node = new Node("k" + i, i); node.end = i * 3; if (i % 2) delete node.operator; nodes.push(node); }
tell("nodes", () => nodes.map((node) => [node.kind, node.start, node.end, node.width(), node.operator]));
tell("keys", () => nodes.map((node) => Object.keys(node).join()));
tell("loop", () => { let sum = 0; for (let t = 0; t < 50; t++) for (const node of nodes) { sum += node.width() + node.start; if (t === 25) { delete node.operator; node.end += 1; } } return sum; });

function dropB(o) { delete o.b; return o; }
tell("base", () => { const o = dropB(new Base(3)); return [Object.keys(o), o.a, o.c, o.b]; });
tell("heir", () => { const o = dropB(new Heir(3)); return [Object.keys(o), o.a, o.c, o.d, String(o.total())]; });
tell("others", () => [new Base(4).total(), new Heir(4).total()]);
tell("sloppy frozen", () => { const o = Object.freeze(new Base(1)); return [delete o.b, o.b, o.total()]; });

const names = ["b", "c", "a"];
function dropNamed(o, name) { delete o[name]; return o; }
tell("unknown", () => { const list = []; for (let i = 0; i < 4; i++) list.push(dropNamed(new Open(i), names[i % 3])); return [list.map((o) => o.total()), list.map((o) => Object.keys(o).join()), list.map((o) => [o.a, o.b, o.c])]; });

tell("reflect", () => { const c = new Counter(1); const done = Reflect.deleteProperty(c, "cache"); return [done, c.bump(), c.label, Object.keys(c)]; });
tell("literal key", () => { const c = new Counter(5); delete c["cache"]; c.cache = 1; return [c.bump(), JSON.stringify(c)]; });
tell("spread", () => { const c = new Counter(7); delete c.cache; return { ...c, z: 1 }; });
tell("assign", () => { const c = new Counter(8); delete c.label; return Object.assign({ label: "old" }, c); });
tell("for in", () => { const c = new Counter(9); delete c.label; const found = []; for (const k in c) found.push(k + c[k]); return found; });
tell("proxy", () => { const c = new Counter(2); const p = new Proxy(c, {}); delete p.cache; return [Object.keys(c), c.bump()]; });
tell("prototype", () => { Counter.prototype.cache = "above"; const c = new Counter(3); delete c.cache; const v = c.cache; delete Counter.prototype.cache; return [v, c.cache === undefined, c.bump()]; });
tell("getter", () => { const c = new Counter(4); delete c.cache; Object.defineProperty(c, "cache", { get() { return this.n; }, enumerable: true, configurable: true }); return [c.cache, c.bump(), c.cache, Object.keys(c)]; });

const records = [];
for (let i = 0; i < 5; i++) { const record = { id: i, name: "r" + i, parent: null, done: false }; if (i & 1) delete record.parent; records.push(record); }
tell("records", () => { let sum = 0; for (let t = 0; t < 40; t++) for (const record of records) { sum += record.id; record.done = !record.done; } return [sum, records]; });
tell("records again", () => records.map((record) => { delete record.name; record.name = "x"; return Object.keys(record).join(); }));
for (const line of out) console.log(line);
