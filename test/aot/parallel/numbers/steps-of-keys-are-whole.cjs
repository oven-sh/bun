// STATISTIC: KeyStepGuardsHoisted >= 1
// step = n / size; for (k = 0; ..; k += step) table[k]: the step of a key is tested for an int32 before the loop.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
function waves(table, n, size) {
  const step = n / size;
  let s = 0;
  for (let j = 0, k = 0; j < size; j++, k += step) s = s * 0.5 + (table[k] ?? -1) + k;
  return s;
}
function fft(re, im, cos, sin, n) {
  for (let i = 0, j = 0; i < n; i++) {
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
    let m = n >> 1;
    while (m >= 1 && j & m) {
      j ^= m;
      m >>= 1;
    }
    j |= m;
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const tr = re[j + half] * cos[k] + im[j + half] * sin[k], ti = im[j + half] * cos[k] - re[j + half] * sin[k];
        re[j + half] = re[j] - tr;
        im[j + half] = im[j] - ti;
        re[j] += tr;
        im[j] += ti;
      }
    }
  }
}
function down(list, from, by) {
  const step = from / by;
  let s = 0;
  for (let k = from, turns = 0; k >= 0 && turns < 40; k -= step, turns++) s = s * 3 + (list[k] || 0) | 0;
  return s;
}
const table = [], cos = [], sin = [];
for (let i = 0; i < 64; i++) {
  table.push(i * 1.5);
  cos.push(Math.cos((2 * Math.PI * i) / 64));
  sin.push(Math.sin((2 * Math.PI * i) / 64));
}
for (const [n, size] of [[64, 2], [64, 32], [64, 64], [64, 3], [63, 2], [0, 4], [-64, 4], [64, 0], [1e10, 4], [2 ** 40, 8], [NaN, 4], [Infinity, 4], [-0, 4], ["64", 8], [64, "8"], [3, 7]]) console.log(show(n), show(size), show(waves(table, n, size)), show(waves([1, 2, , 4, "x"], n, size)), show(waves(new Float32Array([5, 6, 7]), n, size)));
for (const n of [8, 16, 64, 12, 48]) {
  const re = [], im = [];
  for (let i = 0; i < n; i++) {
    re.push(((i * 37) % 11) * 0.125);
    im.push(0);
  }
  try {
    fft(re, im, cos, sin, n);
  } catch (e) {
    console.log(e.constructor.name);
  }
  console.log(n, re.map(x => show(Math.round(x * 1e6) / 1e6)).join(), im.map(x => show(Math.round(x * 1e6) / 1e6)).join());
}
for (const [from, by] of [[60, 5], [60, 7], [0, 3], [2147483647, 1], [2147483647, 2], [-2147483648, 1], [61.5, 3]]) console.log(show(down(table, from, by)), show(down([1, 2, 3], from, by)));
