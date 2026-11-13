// Loops compute with one of two properties of a record.
// STATISTIC: SiteCachedReadsEmitted >= 8
const turns = JSON.parse("40");
let calls = 0;
const record = i => JSON.parse(`{"x":${i / 3 + 0.5},"y":${0.1 + i},"n":${i % 7},"z":${i % 4 ? "null" : i + 1},"ok":${i % 3 > 0}}`);
const list = Array.from({ length: 60 }, (_, i) => record(i));
function chosen(l) { let a = 0; for (const o of l) a += (o.ok ? o.x : o.y) * 2; return a; }
function either(l) { let a = 0; for (const o of l) a += (o.z || o.y) * 0.5; return a; }
function nullish(l) { let a = 0; for (let i = 0; i < l.length; i++) { const o = l[i]; a += (o.z ?? o.n) - 1; } return a; }
function added(l) { let a = 0; for (const o of l) a += o.n > 3 ? o.x : o.y; return a; }
function texts(l) { let a = ""; for (const o of l) a = a.length > 40 ? "" : a + (o.ok ? o.x : o.y); return a; }
let s = 0;
for (let t = 0; t < turns; t++) s += chosen(list) + either(list) + nullish(list) + added(list) + texts(list).length;
console.log(s);
const odd = [record(1), JSON.parse('{"x":"2","y":3,"n":null,"ok":true}'), JSON.parse('{"y":1.5,"z":0}'), Object.freeze(record(4)), new Proxy(record(5), { get(t, k) { calls++; return t[k]; } }),
  Object.defineProperty(record(6), "x", { get() { calls += 10; return "g"; } }), Object.create(record(7)), JSON.parse('{"x":[4],"y":"t","n":9,"z":"","ok":0}'), record(8), 5, "text", record(9)];
for (let t = 0; t < turns; t++) {
  const line = odd.map(o => [chosen, either, nullish, added, texts].map(f => String(f([o, record(2)])).slice(0, 30)).join()).join(" ");
  if (t % 13 === 0) console.log(line, calls);
}
list[7].x = 1n; list[9].y = "b"; list[10].z = -0;
for (const f of [chosen, either, nullish, added, texts]) { try { console.log(String(f(list)).slice(0, 60)); } catch (e) { console.log(e.name); } }
