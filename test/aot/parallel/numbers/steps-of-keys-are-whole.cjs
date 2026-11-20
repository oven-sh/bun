// STATISTIC: KeyStepGuardsHoisted >= 1
// step = n / size; for (k = 0; ..; k += step) table[k]: the step of a key is tested for an int32 before the loop.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
function waves(table, n, size) {
  const step = n / size;
  let s = 0;
  for (let j = 0, k = 0; j < size; j++, k += step) s = s * 0.5 + (table[k] ?? -1) + k;
  return s;
}
function tides(high, low, moon, sun, n) {
  for (let width = 2; width <= n; width += width) {
    const step = n / width;
    for (let from = 0; from + width <= n; from += width) {
      for (let at = from, k = 0; at < from + width; at++, k += step) {
        const pull = moon[k] - sun[k] * high[at];
        low[at] = low[at] / 2 + pull;
        high[at] = pull - high[at] * 0.25;
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
const table = [], moon = [], sun = [];
for (let i = 0; i < 64; i++) {
  table.push(i * 1.5);
  moon.push(Math.cos((2 * Math.PI * i) / 64));
  sun.push(Math.sin((2 * Math.PI * i) / 64));
}
for (const [n, size] of [[64, 2], [64, 32], [64, 64], [64, 3], [63, 2], [0, 4], [-64, 4], [64, 0], [1e10, 4], [2 ** 40, 8], [NaN, 4], [Infinity, 4], [-0, 4], ["64", 8], [64, "8"], [3, 7]]) console.log(show(n), show(size), show(waves(table, n, size)), show(waves([1, 2, , 4, "x"], n, size)), show(waves(new Float32Array([5, 6, 7]), n, size)));
for (const n of [8, 16, 64, 12, 48]) {
  const high = [], low = [];
  for (let i = 0; i < n; i++) {
    high.push(((i * 37) % 11) * 0.125);
    low.push(0);
  }
  try {
    tides(high, low, moon, sun, n);
  } catch (e) {
    console.log(e.constructor.name);
  }
  console.log(n, high.map(x => show(Math.round(x * 1e6) / 1e6)).join(), low.map(x => show(Math.round(x * 1e6) / 1e6)).join());
}
for (const [from, by] of [[60, 5], [60, 7], [0, 3], [2147483647, 1], [2147483647, 2], [-2147483648, 1], [61.5, 3]]) console.log(show(down(table, from, by)), show(down([1, 2, 3], from, by)));
