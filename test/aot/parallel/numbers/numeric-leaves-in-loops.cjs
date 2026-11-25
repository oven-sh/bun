// STATISTIC: CallsInlined >= 50
// Functions with branches that only calculate, called in loops with elements, fields, parameters and captured values: the loop has a copy of them behind guards for numbers.
let calls = 0;
const show = v => (typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : String(v));
function branches(x) {
  let t = x * 0.5;
  if (t > 20) t = t * 1.5;
  if (t > 30) t = t - 3.25;
  if (t > 40) t = t / 1.75;
  if (t > 10) t = t + x;
  if (t < 5) t = t * t;
  if (t > 60) t = t - x * 0.125;
  return t;
}
function bits(x) {
  let t = x;
  if (t > 50) t = t - 7;
  else t = t + 5;
  if (t & 1) t = t ^ 33;
  if (t & 2) t = (t << 1) & 255;
  if (t & 4) t = t + x;
  if (t & 8) t = t - 3;
  if (t & 16) t = t ^ x;
  if (t & 32) t = (t * 3) & 1023;
  if (t & 64) t = t + 1;
  return t;
}
function wave(x, y) {
  const p = x - Math.floor(x / 6.5) * 6.5;
  let q = p < 3.25 ? p : 6.5 - p;
  if (q > y) q = Math.sqrt(q - y) + Math.abs(y);
  if (q !== q) return y;
  return q < 1 ? q * q : q < 2 ? 2 * q - 1 : q < 3 ? q + 1 : Math.min(q, y, 4);
}
function elements(f, n) {
  return n;
}
function overElements(v, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + branches(v[i]);
  return s;
}
function bitsOverElements(v, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + bits(v[i])) & 65535;
  return s;
}
function wavesOverElements(v, w, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.25 + wave(v[i], w[n - 1 - i]);
  return s;
}
function overFields(items, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + branches(items[i].v) - bits(items[i].v);
  return s;
}
function overParameter(x, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + branches(x) + bits(x) + wave(x, i);
  return s;
}
function carried(x, n) {
  let s = x;
  for (let i = 0; i < n; i++) s = branches(s);
  return s;
}
function storing(v, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    v[i & 7] = branches(v[(i + 1) & 7]);
    s += v[i & 7];
  }
  return s;
}
const counted = { valueOf() { calls++; return 24.5; } };
const lists = [
  [0, 1, 2, 3, 4, 5, 6, 7, 40, 60, 80, 100],
  [0.5, 41.25, 2.75, 63.5, -4, 5, -0, 7, 40, 60, 80, 100],
  [NaN, Infinity, -Infinity, -0, 2147483647, -2147483648, 2147483648, 9007199254740991, 9007199254740992, 5e-324, 1e300, 4294967295],
  [1, , 2, 3, , 5, 6, 7, 8, 9, 10, 11],
  [0.5, , 2.5, 3, , 5, 6, 7, 8, 9, 10, 11.5],
  [1, 2, "3", 4, "x", 5, 6, 7, 8, 9, 10, 11],
  [1, 2, undefined, 4, null, 5, true, 7, counted, 9, {}, [12]],
  [1, 2, 3, 4, 5, 6, 7, 8, 9n, 9, 10, 11],
  [1, 2, 3, 4, 5, 6, 7, 8, Symbol.iterator, 9, 10, 11],
];
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return e.constructor.name;
  }
}
for (let round = 0; round < 2; round++) {
  for (const v of lists) {
    for (const n of [0, 1, 5, 12]) {
      console.log(attempt(() => overElements(v, n)), attempt(() => bitsOverElements(v, n)), attempt(() => wavesOverElements(v, lists[(n + round) % 4], n)), calls);
    }
    console.log(attempt(() => overFields(v.map((v, k) => ({ v, k })), 12)), attempt(() => storing(v.slice(0, 8), 9)), calls);
  }
}
for (const x of [0, 1, 50, 64.5, -0, NaN, "7", "x", undefined, null, true, counted, 3n, Symbol.iterator, {}, [5]]) console.log(attempt(() => overParameter(x, 4)), attempt(() => carried(x, 5)), calls);
console.log(overElements(new Float64Array([1.5, 60, 80, NaN]), 4), bitsOverElements(new Int32Array([1, -2, 60, 2147483647]), 4), bitsOverElements(new Uint8Array([1, 2, 60, 255]), 4), overElements(new Float32Array([1.5, 60.1]), 2), attempt(() => overElements(new BigInt64Array(2), 2)), elements(0, 3));
