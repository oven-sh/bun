// The element that a sum starts from was stored just before in the same iteration, rounded to the kind of the view.
function restart(a, x, y, n) {
  for (let i = 0; i < n; i++) {
    y[i] = x[n - 1 - i] * 2;
    let s = y[i];
    for (let k = 0; k < n; k++) s += a[i * n + k] * x[k];
    y[i] = s;
  }
}
function restart2(a, x, y, n, scale) {
  for (let i = 0; i < n; i++) {
    y[i] = scale;
    let s = y[i];
    for (let k = 0; k < n; k++) s += a[k * n + i] * x[k];
    y[i] = s;
  }
}
function asm(global, buffer) {
  "use asm";
  var singles = new global.Float32Array(buffer);
  function run(n, from, into, scale) {
    n = n | 0; from = from | 0; into = into | 0; scale = +scale;
    var i = 0, k = 0, s = 0.0;
    do {
      singles[into + (i << 2) >> 2] = scale;
      s = +singles[into + (i << 2) >> 2];
      k = 0;
      do {
        s = s + +singles[from + (i << 2) + (k << 2) >> 2] * +singles[(k << 2) >> 2];
        k = k + 1 | 0;
      } while ((k | 0) != (n | 0));
      singles[into + (i << 2) >> 2] = s;
      i = i + 1 | 0;
    } while ((i | 0) != (n | 0));
  }
  return { run: run };
}
let seed = 5;
function next() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; }
function fill(v) { for (let i = 0; i < v.length; i++) v[i] = (next() % 2000 - 1000) / 64; return v; }
function show(y) { let r = 7; for (let i = 0; i < y.length; i++) r = Math.imul(r ^ (y[i] * 4096), 16777619) >>> 0; return r; }
const lines = [];
for (const n of [8, 12, 16, 21]) {
  const a = fill(new Float64Array(n * n)), x = fill(new Float64Array(n)), y = fill(new Float32Array(n)), z = fill(new Float32Array(n));
  restart(a, x, y, n); lines.push(show(y));
  restart2(a, x, z, n, 0.1); lines.push(show(z));
}
const buffer = new ArrayBuffer(8192), all = fill(new Float32Array(buffer));
const m = asm({ Float32Array: Float32Array }, buffer);
for (const n of [8, 13, 30]) { m.run(n, 400, 4000, 0.1); lines.push(show(all)); }
console.log(lines.join(" "));
