// Closures that are lent: builtins untyped. It prints what plain Bun prints.
function viaMap(xs, k) { return xs.map(v => v * k); }
function viaForEach(xs, k) { let s = 0; xs.forEach(v => { s += v * k; }); return s; }
function viaFilter(xs, k) { return xs.filter(v => v > k); }
function viaReduce(xs, k) { return xs.reduce((a, v) => a + v * k, 0); }
function viaSort(xs, k) { return xs.slice().sort((a, b) => (a - b) * k); }
function viaSome(xs, k) { return xs.some(v => v === k); }
function viaEvery(xs, k) { return xs.every(v => v !== k); }
function viaFind(xs, k) { return xs.find(v => v === k); }
function viaFindIndex(xs, k) { return xs.findIndex(v => v === k); }
function viaMapForEach(m, k) { let s = 0; m.forEach((v, key) => { s += v * k + key; }); return s; }
function viaSetForEach(m, k) { let s = 0; m.forEach(v => { s += v * k; }); return s; }
function viaReplace(t, k) { return t.replace(/a/g, m => m + k); }
function viaPromise(k) { return new Promise(resolve => resolve(k)); }
function viaFlatMap(xs, k) { return xs.flatMap(v => [v, k]); }
function viaArrayFrom(xs, k) { return Array.from(xs, v => v + k); }

const xs = [1, 2, 3, 4, 5, 6, 7, 8];
const m = new Map([[1, 2], [3, 4]]);
const st = new Set([1, 2, 3]);
let total = 0;
for (let i = 0; i < 1000; i++) {
  total += viaMap(xs, i).length + viaForEach(xs, i) + viaFilter(xs, i & 7).length + viaReduce(xs, i) + viaSort(xs, 1 + (i & 1))[0];
  total += (viaSome(xs, i & 15) ? 1 : 0) + (viaEvery(xs, i & 15) ? 1 : 0) + (viaFind(xs, i & 15) ?? 0) + viaFindIndex(xs, i & 15);
  total += viaMapForEach(m, i) + viaSetForEach(st, i) + viaReplace("banana", i).length + viaFlatMap(xs, i).length + viaArrayFrom(xs, i).length;
  viaPromise(i);
}
console.log(total);
