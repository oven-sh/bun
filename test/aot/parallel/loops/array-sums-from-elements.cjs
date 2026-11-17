// Sums over flat arrays that start from elements of arrays, of the stored one too, and stores that add elements. Holes and NaN among them.
// STATISTIC: ViewSumNests >= 2
function layer(weights, biases, input, output) {
  const inputs = input.length, outputs = output.length;
  for (let o = 0; o < outputs; o++) {
    let sum = biases[o];
    for (let i = 0; i < inputs; i++) sum += weights[o * inputs + i] * input[i];
    output[o] = sum > 0 ? sum : 0;
  }
}
function accumulate(a, x, y, n) {
  for (let i = 0; i < n; i++) {
    let s = y[i];
    for (let k = 0; k < n; k++) s -= a[i * n + k] * x[k];
    y[i] = s;
  }
}
function shifted(a, x, y, n) {
  for (let i = 0; i + 1 < n; i++) {
    let s = y[i + 1];
    for (let k = 0; k < n; k++) s += a[i * n + k] * x[k];
    y[i] = s;
  }
}
function carried(a, x, y, n) {
  for (let i = 1; i < n; i++) {
    let s = y[i - 1];
    for (let k = 0; k < n; k++) s += a[i * n + k] * x[k];
    y[i] = s;
  }
}
function added(a, x, b, y, n) {
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += a[i * n + k] * x[k];
    y[i] = s + b[i];
  }
}
let seed = 13;
function next() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}
function make(length) {
  const result = [];
  for (let index = 0; index < length; index++) result.push((next() % 2000 - 1000) / 64 + 0.125);
  return result;
}
function show(array) {
  let result = array.length + ":", hash = 7;
  for (let index = 0; index < array.length; index++) {
    const value = array[index];
    if (!(index in array)) result += index + "_";
    else if (value !== value) result += index + "n";
    else hash = Math.imul(hash ^ (value * 4096), 16777619) >>> 0;
  }
  return result + hash;
}
const lines = [];
function run(n, change) {
  const a = make(n * n), x = make(n), b = make(n), y = make(n), output = make(n);
  change(a, x, b, y);
  layer(a, b, x, output);
  lines.push(show(output));
  accumulate(a, x, y, n);
  lines.push(show(y));
  shifted(a, x, y, n);
  lines.push(show(y));
  carried(a, x, y, n);
  lines.push(show(y));
  added(a, x, b, output, n);
  lines.push(show(output));
  added(a, x, y, y, n);
  lines.push(show(y));
  accumulate(a, y, y, n);
  lines.push(show(y));
}
for (const n of [8, 9, 12, 21, 33]) run(n, () => {});
run(12, (a, x, b, y) => { b[5] = NaN; y[7] = NaN; });
run(12, (a, x, b, y) => { delete b[3]; delete y[9]; });
run(12, (a, x, b, y) => { b.length = 7; y.length = 10; });
run(12, (a, x, b, y) => { b[2] = -0; y[2] = -0; x[1] = Infinity; });
run(12, (a, x, b, y) => { for (let i = 0; i < 12; i++) b[i] = i; });
run(12, (a, x, b, y) => { b[4] = "3"; y[4] = undefined; });
console.log(lines.join("\n"));
