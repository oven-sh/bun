// Loops compute with properties of records that are null, undefined or missing in some.
// STATISTIC: SiteReadsOfNullishNumbers >= 12
const turns = JSON.parse("40");
let calls = 0;
const record = i => JSON.parse(`{"x":${i % 3 ? i / 4 : null},"y":${i % 4 ? 0.1 + i : null},"n":${i % 5 ? i : null},"k":${i}}`);
const list = Array.from({ length: 60 }, (_, i) => record(i));
for (let i = 0; i < list.length; i += 7) list[i].y = undefined;
for (let i = 0; i < list.length; i += 11) delete list[i].n;
const show = v => (Object.is(v, -0) ? "-0" : String(v));
function sums(l) { let a = 0; for (const o of l) a += o.x + o.k; return a; }
function many(l) { let a = 0; for (let i = 0; i < l.length; i++) { const o = l[i]; const v = o.x + o.y + o.n + o.k; if (v === v) a += v; } return a; }
function products(l) { let a = 0; for (const o of l) a += o.x * o.k - o.n / 2; return a; }
function differences(l) { const r = []; for (const o of l) r.push(o.k - o.x); return r.map(show).join(); }
function negated(l) { const r = []; for (const o of l) r.push(o.x * -1); return r.map(show).join(); }
function alone(l) { const r = []; for (const o of l) r.push(o.x + o.y); return r.map(show).join(); }
function texts(l) { let t = ""; for (const o of l) { t = t.length > 50 ? "" : t + o.x; t += o.n + "," + o.y; } return t; }
function compared(l) { let a = 0; for (const o of l) { if (o.x > 2) a++; if (o.x === null) a += 100; if (o.y == null) a += 10000; if (o.n <= 0) a += 0.5; } return a; }
const forms = [sums, many, products, differences, negated, alone, texts, compared];
for (let t = 0; t < turns; t++) {
  const line = forms.map(f => String(f(list)).slice(0, 200)).join(" ");
  if (t % 13 === 0) console.log(line);
}
const odd = [record(1), record(3), JSON.parse('{"x":"2","y":3,"n":true,"k":false}'), JSON.parse('{"x":[],"y":{},"n":"","k":null}'), new Proxy(record(6), { get(t, k) { calls++; return t[k]; } }),
  Object.defineProperty(record(9), "x", { get() { calls += 10; return null; } }), Object.create(record(12)), JSON.parse("{}"), Object.freeze(record(15)), 5, "text", record(18)];
for (let t = 0; t < turns; t++) {
  const line = odd.map(o => forms.map(f => String(f([o, record(2), record(4)])).slice(0, 40)).join(":")).join(" ");
  if (t % 13 === 0) console.log(line, calls);
}
list[8].x = 2n; list[9].k = 3n; list[10].y = Symbol("s");
for (const f of forms) { try { console.log(String(f(list)).slice(0, 60)); } catch (e) { console.log(e.name); } }
