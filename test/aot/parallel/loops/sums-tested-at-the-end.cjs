// The inner loop leaves from another block than its header.
// STATISTIC: ViewSumNests >= 1
function filtered(image, weights, output, length, taps, start) {
  for (let i = 0; i + taps <= length; i++) {
    let sum = start | 0, k = 0;
    if (k < taps) do {
      sum = sum - Math.imul(image[i + k], weights[k]) | 0;
    } while (++k < taps);
    output[i] = sum >> 2;
  }
}
function summed(a, b, output, n, start) {
  for (let i = 0; i < n; i++) {
    let sum = start, k = 0;
    if (k < n) do {
      sum += a[i * n + k] * b[k * n + i];
    } while (++k < n);
    output[i] = sum;
  }
}
let seed = 5;
function fill(view) {
  for (let index = 0; index < view.length; index++) view[index] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 1024;
  return view;
}
for (const n of [8, 9, 12, 5, 1, 0, 31]) {
  const output = new Int32Array(64), sums = new Float64Array(n);
  filtered(fill(new Uint16Array(64)), fill(new Int16Array(n)), output, 64, n, n * 100000007);
  summed(fill(new Float64Array(n * n)), fill(new Float64Array(n * n)), sums, n, 0.5);
  console.log(output.join(), sums.join());
}
