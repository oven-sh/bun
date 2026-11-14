// Loops over records in functions that are inlined into loops: each version of the outer loop reads the records by their sites.
// STATISTIC: SiteCachedReadsEmitted >= 12
const turns = JSON.parse("40");
const list = JSON.parse("[" + Array.from({ length: 40 }, (_, i) => `{"id":${i},"x":${i / 4 + 0.5},"y":${i},"n":${i % 7}}`).join() + "]");
let s = 0;
function sum(l) { let a = 0; for (let i = 0; i < l.length; i++) { const o = l[i]; a += o.x + o.y; } return a; }
for (let t = 0; t < turns; t++) s += sum(list);
console.log(s);
function sumWhile(l) { let a = 0, i = 0; while (i < l.length) { const o = l[i++]; a += o.x + o.n; } return a; }
for (let t = 0; t < turns; t++) s += sumWhile(list);
console.log(s);
function sumLength(l) { let a = 0; for (let i = 0, n = l.length; i < n; i++) { const o = l[i]; a += o.y + o.n; } return a; }
for (let t = 0; t < turns; t++) { s += sumLength(list); if (t === 20) list[7].y = 0.25; if (t === 30) list[9] = JSON.parse('{"y":5,"x":1,"n":2}'); }
console.log(s);
function store(l) { for (let i = 0; i < l.length; i++) l[i].n = i; return l[3].n; }
for (let t = 0; t < turns; t++) { s += store(list); if (t === 10) Object.freeze(list[11]); if (t === 20) Object.defineProperty(list[12], "n", { get() { return 5; }, set(v) { s += v; }, configurable: true }); }
console.log(s, JSON.stringify(list.slice(8, 14)));
function change(l, v) { for (let i = 0; i < l.length; i++) if (l[i].id === v) l[i].x = "x" + v; return l.length; }
for (let t = 0; t < turns; t++) s += change(list, t);
console.log(s, list[5].x);
for (let t = 0; t < 4; t++) s += sum(list);
console.log(String(s).length, String(s).slice(0, 40));
list[20] = null;
try { for (let t = 0; t < turns; t++) s = sum(list); } catch (e) { console.log(e.name); }
