// What a sum over views becomes is selected after the inner loop: below zero, above a limit, by the column, with NaN, infinities and -0 among the elements.
// STATISTIC: ViewSumNests >= 3
function layer(weights, biases, input, output) {
  const inputs = input.length, outputs = output.length;
  for (let o = 0; o < outputs; o++) {
    let sum = biases[o];
    for (let i = 0; i < inputs; i++) sum += weights[o * inputs + i] * input[i];
    output[o] = sum > 0 ? sum : 0;
  }
}
function limited(a, w, y, n, m, low, high) {
  for (let i = 0; i + m <= n; i++) {
    let s = 0;
    for (let k = 0; k < m; k++) s += a[i + k] * w[k];
    const above = s < low ? low * 0.5 : s;
    y[i] = above > high ? high + i : above;
  }
}
function edges(x, h, y) {
  const taps = h.length;
  for (let i = taps - 1; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < taps; k++) s += h[k] * x[i - k];
    y[i] = i < 20 ? s * s : s - i;
  }
}
let seed = 9;
function next() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}
function fill(view, values) {
  for (let index = 0; index < view.length; index++) {
    const random = next();
    view[index] = random % 9 ? (random % 2000 - 1000) / 64 : values[(random >> 8) % values.length];
  }
  return view;
}
function show(y) {
  let result = 7, nothing = 0, negative = 0;
  for (let index = 0; index < y.length; index++) {
    const value = y[index];
    if (value !== value) nothing++;
    else result = Math.imul(result ^ (value * 4096), 16777619) >>> 0;
    if (Object.is(value, -0)) negative++;
  }
  return result + ":" + nothing + ":" + negative;
}
for (const values of [[0.5], [-0, 0], [NaN, 2], [Infinity, -3], [1e308, -1e308]]) {
  const lines = [];
  for (const [inputs, outputs] of [[16, 16], [9, 40], [8, 5], [33, 12], [7, 9]]) {
    const weights = fill(new Float32Array(inputs * outputs), values), biases = fill(new Float32Array(outputs), values), input = fill(new Float32Array(inputs), values), output = new Float32Array(outputs);
    layer(weights, biases, input, output);
    lines.push(show(output));
    const x = fill(new Float64Array(inputs * 8), values), h = fill(new Float64Array(outputs), values), y = new Float64Array(inputs * 8);
    edges(x, h, y);
    lines.push(show(y));
    limited(x, h, y, inputs * 8, outputs, -40, 60);
    lines.push(show(y));
    limited(x, h, x, inputs * 8, outputs, NaN, 60);
    lines.push(show(x));
  }
  console.log(lines.join(" "));
}
