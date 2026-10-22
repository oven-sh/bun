// Receivers that flow cannot see: arrays that came back out of JSON text chosen at run time.
const data = JSON.parse(process.argv[2] ?? '{"a":[1,2,3,4,5,6,7,8],"b":{"c":[3,1,2]}}');
function viaSome(o, k) { return o.a.some(v => v === k); }
function viaMap(o, k) { return o.a.map(v => v * k); }
function viaForEach(o, k) { let s = 0; o.a.forEach(v => { s += v * k; }); return s; }
function viaFilter(o, k) { return o.a.filter(v => v > k); }
function viaReduce(o, k) { return o.a.reduce((a, v) => a + v * k, 0); }
function viaFind(o, k) { return o.a.find(v => v === k); }
function viaEvery(o, k) { return o.a.every(v => v !== k); }
function viaSort(o, k) { return o.b.c.slice().sort((a, b) => (a - b) * k); }
function viaFlatMap(o, k) { return o.a.flatMap(v => [v, k]); }
let total = 0;
for (let i = 0; i < 2000; i++) {
  total += (viaSome(data, i & 15) ? 1 : 0) + viaMap(data, i).length + viaForEach(data, i) + viaFilter(data, i & 7).length + viaReduce(data, i) + (viaFind(data, i & 15) ?? 0) + (viaEvery(data, i & 15) ? 1 : 0) + viaSort(data, 1 + (i & 1))[0] + viaFlatMap(data, i).length;
}
console.log(total);
