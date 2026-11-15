// Loops take records of JSON.parse apart and compute with what the names hold.
// STATISTIC: SiteCachedReadsEmitted >= 12
const turns = JSON.parse("40");
let calls = 0;
const record = i => JSON.parse(`{"id":${i},"x":${i / 3 + 0.5},"y":${0.1 + i},"n":${i % 7}}`);
const list = Array.from({ length: 60 }, (_, i) => record(i));
function sums(l) { let a = 0; for (const { x, y, n } of l) a += x * y + n; return a; }
function counted(l) { let a = 0; for (let i = 0; i < l.length; i++) { const { x, n } = l[i]; a += x - n * 2; } return a; }
function declared(l) { let a = 0; for (const o of l) { const x = o.x, y = o.y, n = o.n; a += x * y + n; } return a; }
function mapped(l) { return l.map(({ x, y }) => x * y); }
let s = 0;
for (let t = 0; t < turns; t++) s += sums(list) + counted(list) + declared(list) + mapped(list)[5];
console.log(s);
const odd = [record(1), JSON.parse('{"x":"2","y":3,"n":null}'), JSON.parse('{"y":1.5}'), Object.freeze(record(4)), new Proxy(record(5), { get(t, k) { calls++; return t[k]; } }),
  Object.defineProperty(record(6), "x", { get() { calls += 10; return 2; } }), Object.create(record(7)), JSON.parse('{"x":[4],"y":true,"n":{"z":1}}'), record(8), 5, "text", [1, 2], record(9)];
function each(l, f) { const r = []; for (const o of l) r.push(String(f([o, record(2)]))); return r.join(); }
for (let t = 0; t < turns; t++) {
  const line = [each(odd, sums), each(odd, counted), each(odd, declared), each(odd, l => mapped(l)[0])].join(" ");
  if (t % 13 === 0) console.log(line, calls);
}
for (const gap of [null, undefined]) {
  for (const f of [sums, counted, declared, mapped]) {
    try { console.log(String(f([record(3), gap, record(4)]))); } catch (e) { console.log(e.name); }
  }
}
list[5].x = "t"; delete list[6].y; list[7].n = 1n; list[8].n = -0; list[9].x = -0; list[9].y = 0;
for (const f of [l => mapped(l).slice(4, 10).map(v => Object.is(v, -0) ? "-0" : String(v)).join(), sums]) { try { console.log(f(list)); } catch (e) { console.log(e.name); } }
