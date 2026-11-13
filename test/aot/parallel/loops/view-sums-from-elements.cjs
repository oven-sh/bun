// Rows of a matrix times a vector: positions that the loop itself tests, sums that start from elements of views, of the stored one too.
// STATISTIC: ViewSumNests >= 2
function multiply(a, x, y, n) {
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += a[i * n + k] * x[k];
    y[i] = s;
  }
}
function layer(weights, biases, input, output) {
  const inputs = input.length, outputs = output.length;
  for (let o = 0; o < outputs; o++) {
    let sum = biases[o];
    for (let i = 0; i < inputs; i++) sum += weights[o * inputs + i] * input[i];
    output[o] = sum * 0.5;
  }
}
function accumulate(a, x, y, n) {
  for (let i = 0; i < n; i++) {
    let s = y[i];
    for (let k = 0; k < n; k++) s -= a[k * n + i] * x[k];
    y[i] = s;
  }
}
// What the sum starts from is stored just before.
function restart(a, x, y, n) {
  for (let i = 0; i < n; i++) {
    y[i] = x[n - 1 - i] * 2;
    let s = y[i];
    for (let k = 0; k < n; k++) s += a[i * n + k] * x[k];
    y[i] = s;
  }
}
let seed = 5;
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
const lines = [];
for (const [length, vector, results, n] of [[256, 16, 16, 16], [400, 20, 20, 20], [399, 20, 20, 20], [400, 19, 20, 20], [400, 20, 13, 20], [81, 9, 9, 9], [64, 8, 8, 8], [49, 7, 7, 7], [1000, 40, 40, 31]]) {
  const a = fill(new Float64Array(length)), x = fill(new Float64Array(vector)), y = fill(new Float64Array(results));
  multiply(a, x, y, n);
  lines.push(show(y));
  accumulate(a, x, y, n);
  lines.push(show(y));
  const singles = fill(new Float32Array(results));
  restart(a, x, singles, n);
  lines.push(show(singles));
  const weights = fill(new Float32Array(length)), biases = fill(new Float32Array(results)), input = fill(new Float32Array(vector)), output = new Float32Array(n);
  layer(weights, biases, input, output);
  lines.push(show(output));
}
const shared = new ArrayBuffer(8192);
for (const [first, second] of [[2048, 4096], [0, 2048], [2048, 2048], [2048, 2056], [2048, 2040]]) {
  fill(new Float64Array(shared));
  const a = new Float64Array(shared, 0, 256), x = new Float64Array(shared, 6400, 16), from = new Float64Array(shared, first, 16), into = new Float64Array(shared, second, 16);
  layer(a, from, x, into);
  lines.push(show(into));
  accumulate(a, from, into, 16);
  lines.push(show(into));
  multiply(a, into, from, 16);
  lines.push(show(from));
}
console.log(lines.join(" "));
