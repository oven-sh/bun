// Filters over views: the bound of the inner loop is the least of several lengths, which the last columns reach; i + m <= n; joins before the inner loop.
// STATISTIC: ViewSumNests >= 2
function filter(x, h, y) {
  for (let i = 0; i < y.length; i++) {
    let s = 0;
    for (let k = 0; k < h.length; k++) s += h[k] * x[i + k];
    y[i] = s;
  }
}
function convolve(a, w, y, n, m) {
  for (let i = 0; i + m <= n; i++) {
    let s = 0;
    for (let k = 0; k < m; k++) s += a[i + k] * w[k];
    y[i] = s;
  }
}
function delayed(x, h, y) {
  const taps = h.length;
  for (let i = taps - 1; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < taps; k++) s += h[k] * x[i - k];
    y[i] = s;
  }
}
let seed = 3;
function next() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}
function fill(view) {
  for (let index = 0; index < view.length; index++) view[index] = (next() % 2000 - 1000) / 64;
  return view;
}
function show(y) {
  let result = 7, nothing = 0;
  for (let index = 0; index < y.length; index++) {
    const value = y[index];
    if (value !== value) nothing++;
    else result = Math.imul(result ^ (value * 4096), 16777619) >>> 0;
  }
  return result + ":" + nothing;
}
const shared = new ArrayBuffer(4096);
const lines = [];
for (const [first, second, third] of [[60, 8, 53], [60, 9, 60], [60, 33, 20], [9, 8, 2], [200, 16, 185], [200, 16, 184], [40, 60, 40], [64, 0, 8], [8, 8, 8]]) {
  const x = fill(new Float64Array(first)), h = fill(new Float64Array(second)), y = fill(new Float64Array(third));
  filter(x, h, y);
  lines.push(show(y));
  convolve(x, h, y, first, second);
  lines.push(show(y));
  convolve(x, h, y, third, 8);
  lines.push(show(y));
  delayed(x, h, y);
  lines.push(show(y));
}
for (const [first, second, third] of [[0, 800, 1600], [0, 800, 0], [0, 800, 8], [800, 800, 0], [64, 800, 0]]) {
  fill(new Float64Array(shared));
  const x = new Float64Array(shared, first, 80), h = new Float64Array(shared, second, 12), y = new Float64Array(shared, third, 69);
  filter(x, h, y);
  lines.push(show(y));
  convolve(x, h, y, 80, 12);
  lines.push(show(y));
  delayed(x, h, y);
  lines.push(show(x));
}
console.log(lines.join(" "));
