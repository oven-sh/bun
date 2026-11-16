// Records are updated in loops that meet literals and instances of the same file too.
const turns = JSON.parse("40");
let calls = 0;
const record = i => JSON.parse(`{"x":${i},"y":${i / 4 + 0.5},"name":"p${i}","n":${i % 5}}`);
const literal = i => ({ name: "q" + i, y: i / 2, x: i, n: 1 });
class Point {
  constructor(i) { this.x = i / 8; this.y = 0.25; this.n = i; this.name = "r"; }
  total() { return this.x + this.y + this.n; }
}
class Wide extends Point { constructor(i) { super(i); this.z = 1; } }
console.log(literal(3).x + literal(4).y, new Point(5).total(), new Wide(6).total());
const list = Array.from({ length: 40 }, (_, i) => record(i));
function move(l) { for (const o of l) o.x += o.y * 0.25; return l[3].x; }
function count(l) { for (let i = 0; i < l.length; i++) { const o = l[i]; o.n = (o.n + 1) & 7; } return l[4].n; }
let s = 0;
for (let t = 0; t < turns; t++) s += move(list) + count(list);
console.log(s);
const accessor = new Point(7);
Object.defineProperty(accessor, "x", { get() { calls++; return 2; }, set(v) { calls += 10; }, configurable: true });
const readOnly = literal(8);
Object.defineProperty(readOnly, "x", { value: 1, writable: false });
const odd = [record(1), new Point(2), literal(3), Object.freeze(new Point(4)), Object.freeze(literal(5)), accessor, readOnly, record(6), new Wide(9),
  new Proxy(new Point(10), { get(t, k) { calls++; return t[k]; }, set(t, k, v) { calls++; t[k] = v; return true; } }), Object.create(new Point(11)), Object.seal(new Wide(12)), JSON.parse('{"y":2,"n":1}'), JSON.parse('{"x":"t","y":1,"n":"2"}')];
function moveAny(l) { for (const o of l) o.x += o.y * 0.25; }
function countAny(l) { for (let i = 0; i < l.length; i++) { const o = l[i]; o.n = (o.n + 1) & 7; } }
for (let t = 0; t < turns; t++) { moveAny(odd); countAny(odd); if (t === 20) odd.push(new Point(20), record(21)); if (t === 30) { odd[1].y = "1"; delete odd[2].n; delete odd[7].x; } }
console.log(calls, odd.map(o => [String(o.x).length > 20 ? String(o.x).length : o.x, o.y, o.n, Object.keys(o).join("")].join()).join(" "));
function step(o, dt) { o.x += o.y * dt; }
function all(l) { for (const o of l) step(o, 0.5); return l[2].x; }
for (let t = 0; t < turns; t++) s += all(list);
for (let t = 0; t < 5; t++) all([new Point(3), record(4), literal(5), new Wide(6)]);
console.log(s);
function rename(l, text) { for (const o of l) { o.name = o.name + text; if (o.name.length > 6) o.name = "n"; } }
for (let t = 0; t < turns; t++) { rename(list, "a"); rename([new Point(3), literal(4)], "b"); }
console.log(list.map(o => o.name).join());
