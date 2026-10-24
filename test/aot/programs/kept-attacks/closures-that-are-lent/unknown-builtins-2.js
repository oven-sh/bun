// Closures that are lent: unknown builtins. It prints what plain Bun prints.
const data = JSON.parse(process.argv[2] ?? '{"a":[1,2,3,4,5,6,7,8],"b":{"c":[3,1,2]}}');
function viaSome(o, k) { const r = o.a.some(v => v === k); return r ? 1 : 0; }
function viaMap(o, k) { const r = o.a.map(v => v * k); return r.length; }
function viaForEach(o, k) { let s = 0; o.a.forEach(v => { s += v * k; }); return s; }
function viaFilter(o, k) { const r = o.a.filter(v => v > k); return r.length; }
function viaReduce(o, k) { const r = o.a.reduce((a, v) => a + v * k, 0); return r + 1; }
function viaFind(o, k) { const r = o.a.find(v => v === k); return r ?? 0; }
function viaEvery(o, k) { const r = o.a.every(v => v !== k); return r ? 1 : 0; }
function viaSort(o, k) { const r = o.b.c.slice().sort((a, b) => (a - b) * k); return r[0]; }
function viaFlatMap(o, k) { const r = o.a.flatMap(v => [v, k]); return r.length; }
function viaFindIndex(o, k) { const r = o.a.findIndex(v => v === k); return r + 1; }
let total = 0;
for (let i = 0; i < 2000; i++) {
  total += viaSome(data, i & 15) + viaMap(data, i) + viaForEach(data, i) + viaFilter(data, i & 7) + viaReduce(data, i) + viaFind(data, i & 15) + viaEvery(data, i & 15) + viaSort(data, 1 + (i & 1)) + viaFlatMap(data, i) + viaFindIndex(data, i & 15);
}
console.log(total);
