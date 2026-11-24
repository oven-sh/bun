// STATISTIC: CallsInlined >= 45
// Methods and functions that calculate with fields of their receiver and by other functions, called in loops with elements and fields.
let calls = 0;
const show = v => (typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : String(v));
class Scale {
  constructor(k) {
    this.k = k;
  }
  apply(x) {
    let t = x * this.k;
    if (t > 20) t = t * 1.5;
    if (t > 30) t = t - 3.25;
    if (t > 40) t = t / 1.75;
    if (t > 10) t = t + x;
    if (t < 5) t = t * t;
    if (t > 60) t = t - x * 0.125;
    return t;
  }
}
const scale = new Scale(0.5);
function clampInt(x, lo, hi) {
  x = Math.round(x);
  if (x < lo) x = lo;
  if (x > hi) x = hi;
  return x;
}
function ycc(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = (b - y) * 0.564 + 128, cr = (r - y) * 0.713 + 128;
  return (clampInt(y, 0, 255) << 16) | (clampInt(cb, 0, 255) << 8) | clampInt(cr, 0, 255);
}
function two(x, y) {
  let a = x + y;
  let b = x - y;
  if (a > 100) a = a - 50;
  if (b < 0) b = -b;
  if (a > b) a = a + b;
  else b = b + a;
  if (a * b > 900) a = a * 0.5;
  return a + b;
}
function bits(x) {
  let t = x;
  if (t > 50) t = t - 7;
  else t = t + 5;
  if (t & 1) t = t ^ 33;
  if (t & 2) t = (t << 1) & 255;
  if (t & 4) t = t + x;
  if (t & 16) t = t ^ x;
  if (t & 32) t = (t * 3) & 1023;
  return t;
}
function overMethod(v, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + scale.apply(v[i]);
  return s;
}
function overCallees(v, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + ycc(v[i], v[(i + 1) % n], v[(i + 2) % n])) & 0xffffff;
  return s;
}
function overFields(items, v, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + two(items[i].v, v[i]);
  return s;
}
function overBits(items, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + bits(items[i].v);
  return s;
}
function overBitsOfElements(v, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + bits(v[i]);
  return s;
}
const counted = { valueOf() { calls++; return 24.5; } };
const lists = [
  [0, 1, 2, 3, 4, 5, 6, 7, 40, 60, 80, 100],
  [0.5, 41.25, 2.75, 63.5, -4, 5, -0, 7, 40, 60, 80, 100],
  [NaN, Infinity, -Infinity, -0, 2147483647, -2147483648, 2147483648, 9007199254740991, 9007199254740992, 5e-324, 1e300, 4294967295],
  [1, , 2, 3, , 5, 6, 7, 8, 9, 10, 11],
  [1, 2, "3", 4, "x", 5, 6, 7, 8, 9, 10, 11],
  [1, 2, undefined, 4, null, 5, true, 7, counted, 9, {}, [12]],
  [1, 2, 3, 4, 5, 6, 7, 8, 9n, 9, 10, 11],
];
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return e.constructor.name;
  }
}
for (let round = 0; round < 3; round++) {
  for (const v of lists) {
    const items = v.map((v, k) => (round === 2 && k === 5 ? { k, get v() { calls++; return v; } } : { v, k }));
    for (const n of [0, 1, 5, 12]) console.log(attempt(() => overMethod(v, n)), attempt(() => overCallees(v, n)), attempt(() => overFields(items, lists[round], n)), attempt(() => overFields(items, v, n)), attempt(() => overBits(items, n)), attempt(() => overBitsOfElements(v, n)), calls);
  }
  if (round === 1) scale.k = "0.25";
}
console.log(overMethod(new Float64Array([1.5, 60, 80, NaN]), 4), overCallees(new Uint8Array([1, 2, 60, 255]), 4), overBitsOfElements(new Int32Array([1, -2, 60, 2147483647]), 4));
