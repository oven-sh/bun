// A number plus zero has the word of the number; as a number it is never -0.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v));
function inner(w, j, l, c) {
  l = l + w[j] + c;
  const high = l >> 28;
  w[j] = l & 0xfffffff;
  return high;
}
function words(x) {
  const l = x * 1 + 0, m = 0 + x * -1;
  return [l | 0, l >>> 3, ~l, l & 255, m >> 1, m ^ 5, l, m, (x + 0) | 0];
}
const values = [0, -0, 1, -1, 0.5, -0.5, 2147483647, 2147483648, -2147483649, 4294967295, 1e15, 2 ** 53, NaN, Infinity, undefined, null, "7", "x", true];
for (let round = 0; round < 3; round++) {
  for (const x of values) console.log(show(x), words(x).map(show).join());
  for (const list of [[1, 268435455, 3], [0.5, 5e9, -0], [1, , 3], ["4", undefined, null]]) {
    const w = [...list];
    console.log([inner(w, 0, 5, 0), inner(w, 1, 300000000, 0), inner(w, 2, -1, 0)].join(), w.map(show).join());
  }
}
