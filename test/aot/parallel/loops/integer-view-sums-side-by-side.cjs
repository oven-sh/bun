// Nests that add up products with elements of views of integers: bytes, words of 16 and of 32 bits, beside each other, shared by all columns and far apart.
// STATISTIC: ViewSumNests >= 3
function bytes(image, weights, output, length, taps) {
  for (let i = 0; i + taps <= length; i++) {
    let sum = 0;
    for (let k = 0; k < taps; k++) sum += image[i + k] * weights[k];
    output[i] = sum;
  }
}
function signedBytes(image, weights, output, length, taps) {
  for (let i = 0; i + taps <= length; i++) {
    let sum = 0;
    for (let k = 0; k < taps; k++) sum += image[i + k] * weights[k];
    output[i] = sum;
  }
}
function shorts(table, vector, output, n) {
  for (let i = 0; i < n; i++) {
    let sum = 0.5;
    for (let k = 0; k < n; k++) sum += vector[k] * table[i * n + k];
    output[i] = sum;
  }
}
function unsignedShorts(table, vector, output, n) {
  for (let i = 0; i < n; i++) {
    let sum = 0.5;
    for (let k = 0; k < n; k++) sum -= table[k * n + i] * vector[k];
    output[i] = sum;
  }
}
function words(a, b, c, n) {
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += a[k * n + i] * 0.25 + b[k];
    c[i] = sum;
  }
}
let seed = 11;
function next() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}
function fill(view) {
  for (let index = 0; index < view.length; index++) view[index] = (next() >> 4) - 60000000;
  return view;
}
function fractions(length) {
  const view = new Float64Array(length);
  for (let index = 0; index < length; index++) view[index] = (next() % 2000 - 1000) / 64;
  return view;
}
function show(y) {
  let result = 7, nothing = 0;
  for (let index = 0; index < y.length; index++) {
    const value = y[index];
    if (value !== value) nothing++;
    else result = Math.imul(result ^ (value * 64), 16777619) >>> 0;
  }
  return result + ":" + nothing;
}
const lines = [];
for (const [length, taps, n] of [[60, 8, 8], [61, 9, 13], [40, 33, 20], [200, 16, 31], [9, 8, 9], [64, 70, 7]]) {
  const output = new Float64Array(length), small = new Uint8ClampedArray(n), floats = new Float32Array(n);
  bytes(fill(new Uint8Array(length)), fractions(taps), output, length, taps);
  lines.push(show(output));
  signedBytes(fill(new Int8Array(length)), fractions(taps), output, length + 2, taps);
  lines.push(show(output));
  shorts(fill(new Int16Array(n * n)), fractions(n), floats, n);
  lines.push(show(floats));
  unsignedShorts(fill(new Uint16Array(n * n)), fractions(n), small, n);
  lines.push(show(small));
  words(fill(new Int32Array(n * n)), fill(new Uint8ClampedArray(n)), output, Math.min(n, length));
  lines.push(show(output));
}
console.log(lines.join(" "));
