// Records are updated in a file whose own literals and instances have fields of the same names.
// STATISTIC: AddressesFoundInIterations >= 6
const turns = JSON.parse("40");
let calls = 0;
const record = i => JSON.parse(`{"x":${i},"y":${i / 4 + 0.5},"name":"p${i}","n":${i % 5}}`);
const literal = i => ({ name: "q" + i, y: i / 2, x: i, n: 1 });
class Point {
  constructor(i) { this.x = i / 8; this.y = 0.25; this.n = i; this.name = "r"; }
  total() { return this.x + this.y + this.n; }
}
console.log(literal(3).x + literal(4).y, literal(5).name, new Point(5).total());
const list = Array.from({ length: 40 }, (_, i) => record(i));
function move(l) { for (const o of l) o.x += o.y * 0.25; return l[3].x; }
function count(l) { for (let i = 0; i < l.length; i++) { const o = l[i]; o.n = (o.n + 1) & 7; } return l[4].n; }
function step(o, dt) { o.x += o.y * dt; }
function all(l) { for (const o of l) step(o, 0.5); return l[2].x; }
function rename(l, text) { for (const o of l) { o.name = o.name + text; if (o.name.length > 6) o.name = "n"; } }
let s = 0;
for (let t = 0; t < turns; t++) { s += move(list) + count(list) + all(list); rename(list, "a"); }
console.log(s, list.map(o => o.name).join());
const readOnly = Object.defineProperty(record(8), "x", { value: 1, writable: false });
const accessor = Object.defineProperty(record(7), "x", { get() { calls++; return 2; }, set(v) { calls += 10; }, configurable: true });
const odd = [record(1), Object.freeze(record(4)), accessor, readOnly, record(6), new Proxy(record(10), { get(t, k) { calls++; return t[k]; }, set(t, k, v) { calls++; t[k] = v; return true; } }),
  Object.create(record(11)), Object.seal(record(12)), JSON.parse('{"y":2,"n":1}'), JSON.parse('{"x":"t","y":1,"n":"2"}'), [1, 2], record(13)];
for (let t = 0; t < turns; t++) { move(odd); count(odd); all(odd); if (t === 20) odd.push(record(21)); if (t === 30) { odd[0].y = "1"; delete odd[4].n; delete odd[11].x; } }
console.log(calls, odd.map(o => [String(o.x).length > 20 ? String(o.x).length : o.x, o.y, o.n, Object.keys(o).join("")].join()).join(" "));
