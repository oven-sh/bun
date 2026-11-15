// STATISTIC: ParameterGuardsEntered >= 15
// Parameters that functions calculate with, also over joins, by callees and in functions that what a loop calls calls: one check at the entry.
let calls = 0;
const show = v => (typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : String(v));
function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}
function power(b, e) {
  let r = 1;
  while (e > 0) {
    if (e & 1) r *= b;
    b *= b;
    e >>= 1;
  }
  return r;
}
function gcd(a, b) {
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
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
function kept(x, o) {
  if (x > 90) x = x - 90;
  o.x = x;
  o.list.push(x);
  let t = x * 0.5;
  if (t > 20) t = t * 1.5;
  if (t > 30) t = t - 3.25;
  if (t > 10) t = t + x;
  if (t < 5) t = t * t - x;
  return t;
}
function told(x) {
  if (x === undefined) x = 7;
  let t = x - 2;
  if (t > 20) t = t * 1.5 + x;
  if (t > 30) t = t - 3.25 + x;
  if (t > 40) t = t / 1.75 + x;
  return t + x;
}
module.exports = { hue2rgb, hslToRgb, power, gcd, bits, kept, told };
const counted = { valueOf() { calls++; return 24.5; } };
const values = [0, 1, 0.25, 0.75, 40, 64.5, -3, -0, NaN, Infinity, 2147483647, 2147483648, 9007199254740992, "7", "x", undefined, null, true, counted, 3n, Symbol.iterator, {}, [5]];
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return e.constructor.name;
  }
}
function run(f, a, b, c, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = f(a, b, c);
  return s;
}
function colors(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = (s + hslToRgb(list[i % list.length], list[(i + 1) % list.length], list[(i + 2) % list.length])) & 0xffffff;
  return s;
}
function powers(list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + power(list[i % list.length], i & 3) + gcd(list[(i + 1) % list.length], 12);
  return s;
}
function others(list, n) {
  const o = { list: [] };
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + kept(list[i % list.length], o) + told(list[(i + 1) % list.length]) - bits(list[(i + 2) % list.length]);
  return s + o.list.length;
}
function overList(f, list, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + f(list[i % list.length], list[(i + 1) % list.length], 0.5);
  return s;
}
for (let round = 0; round < 2; round++) {
  for (const a of values) {
    for (const b of values.slice(round, 8 + round * 8)) {
      const o = { list: [] };
      console.log(attempt(() => run(hslToRgb, a, b, 0.5, 3)), attempt(() => run(hslToRgb, 0.3, 0.4, a, 3)), attempt(() => run(hue2rgb, a, b, 0.2, 2)), attempt(() => run(hue2rgb, 0.1, 0.4, a, 2)), attempt(() => run(gcd, a, b, 0, 2)), attempt(() => run(kept, a, o, 0, 2)), o.list.length, show(o.x), calls);
    }
    console.log(attempt(() => run(power, a, 5, 0, 2)), attempt(() => run(power, 3, a, 0, 1)), attempt(() => run(bits, a, 0, 0, 3)), attempt(() => run(told, a, 0, 0, 3)), calls);
  }
  for (const list of [[1, 2, 3], [0.5, 2.5, 3], [1, , 3], [1, "2", 3], [1n, 2, 3]]) for (const f of [colors, powers, others]) console.log(attempt(() => f(list, 9)), attempt(() => f(list, 2)), calls);
  for (const list of [[1, 2, 3], [0.5, 2.5, 3], [1, , 3], [1, "2", 3], [1n, 2, 3]]) for (const f of [hslToRgb, hue2rgb, power, gcd, bits, told]) console.log(attempt(() => overList(f, list, 7)), calls);
}
