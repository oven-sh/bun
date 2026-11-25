// Nests whose sums are int32s that wrap around: products by Math.imul and sums of elements of views of integers, four columns a vector.
// STATISTIC: ViewSumNests >= 1
function quantized(a, b, c, n) {
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      let sum = 0;
      for (let term = 0; term < n; term++) sum = sum + Math.imul(a[row * n + term], b[term * n + column]) | 0;
      c[row * n + column] = sum;
    }
  }
}
function filtered(image, weights, output, length, taps, start) {
  for (let i = 0; i + taps <= length; i++) {
    let sum = start | 0;
    for (let k = 0; k < taps; k++) sum = sum - Math.imul(image[i + k], weights[k]) | 0;
    output[i] = sum >> 2;
  }
}
function added(words, output, n) {
  for (let i = 0; i < n; i++) {
    let sum = -2000000000;
    for (let k = 0; k < n; k++) sum = (words[i * n + k] + words[k * n + i] | 0) + sum | 0;
    output[i] = sum;
  }
}
let seed = 3;
function next() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}
function fill(view) {
  for (let index = 0; index < view.length; index++) view[index] = (next() << 2) - 1500000000;
  return view;
}
function show(view) {
  let hash = 7;
  for (let index = 0; index < view.length; index++) hash = Math.imul(hash ^ view[index], 16777619) >>> 0;
  return hash;
}
const lines = [];
for (const n of [8, 9, 12, 17, 31, 5]) {
  const c = new Int32Array(n * n);
  quantized(fill(new Int8Array(n * n)), fill(new Int8Array(n * n)), c, n);
  lines.push(show(c));
  const output = new Int32Array(64);
  filtered(fill(new Uint16Array(64)), fill(new Int16Array(n)), output, 64, n, n * 100000007);
  lines.push(show(output));
  const bytes = new Uint8Array(n);
  added(fill(new Int32Array(n * n)), bytes, n);
  lines.push(show(bytes));
}
const buffer = new ArrayBuffer(4096), words = fill(new Int32Array(buffer));
added(words, new Uint8Array(buffer, 40, 20), 20);
lines.push(show(words));
added(words, new Uint8Array(buffer, 1600, 20), 20);
lines.push(show(words));
added(words.subarray(0, 300), new Uint8Array(buffer, 1700, 20), 20);
lines.push(show(words));
console.log(lines.join(" "));
