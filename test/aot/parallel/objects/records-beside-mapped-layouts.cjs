// Records of JSON.parse are read in a file whose literals and classes are made of the same names.
// STATISTIC: LoopsReversionedWithoutNameGuesses >= 3
const turns = JSON.parse("40");
let calls = 0;
const record = i => JSON.parse(`{"id":${i},"name":"p${i}","x":${i / 3 + 0.5},"y":${0.1 + i},"n":${i % 7}}`);
const list = Array.from({ length: 60 }, (_, i) => record(i));
function reply(o) { return { id: o.id, name: o.name, x: o.x * 2, y: o.y, n: o.n, ok: true }; }
class Row { constructor(o) { this.key = o.id; this.width = o.width; this.height = o.height; } get area() { return this.width * this.height; } }
console.log(JSON.stringify(list.slice(0, 2).map(reply)), JSON.stringify([new Row(JSON.parse('{"id":1,"width":2,"height":3}'))]));
function products(l) { let a = 0; for (const o of l) a += o.x * o.y; return a; }
function chosen(l) { let a = 0; for (let i = 0; i < l.length; i++) { const o = l[i]; if (o.x > 4 && o.n < 3) a += o.x - o.n; } return a; }
function moved(l) { for (const o of l) o.x += o.y * 0.016; return l[3].x; }
function areas(l) { let a = 0; for (const o of l) a += o.width * o.height; return a; }
const sizes = Array.from({ length: 50 }, (_, i) => JSON.parse(`{"width":${i},"height":${i / 2}}`));
let s = 0;
for (let t = 0; t < turns; t++) s += products(list) + chosen(list) + moved(list) + areas(sizes);
console.log(s);
const replies = list.slice(10, 20).map(reply), rows = sizes.slice(5, 15).map(o => new Row(o));
for (let t = 0; t < turns; t++) s += products(replies) + chosen(replies) + moved(replies) + areas(rows);
console.log(s);
const odd = [record(1), reply(record(2)), record(3), JSON.parse('{"x":"4","y":null,"n":1}'), Object.freeze(reply(record(5))), Object.freeze(record(6)), new Proxy(reply(record(7)), { get(t, k) { calls++; return t[k]; }, set(t, k, v) { calls++; t[k] = v; return true; } }),
  Object.defineProperty(reply(record(8)), "x", { get() { calls += 10; return 2; }, set(v) { calls += 100; } }), JSON.parse('{"n":2}'), Object.create(reply(record(9))), reply(record(10)), record(11)];
for (let t = 0; t < turns; t++) {
  const line = [products(odd), chosen(odd), moved(odd), products(list), products(replies)].join();
  if (t % 13 === 0) console.log(line, calls, odd.map(o => String(o.x)).join());
  if (t === 20) { list[3] = reply(list[3]); list[30] = JSON.parse('{"x":1}'); replies[2] = record(2); rows[1] = JSON.parse('{"width":4,"height":5}'); sizes[2] = new Row(JSON.parse('{"width":1,"height":2}')); }
  if (t > 20) s += areas(rows) + areas(sizes) + products(replies);
}
console.log(s, calls);
for (const f of [products, chosen, moved]) { try { console.log(String(f([record(1), reply(record(2)), undefined]))); } catch (e) { console.log(e.name); } }
