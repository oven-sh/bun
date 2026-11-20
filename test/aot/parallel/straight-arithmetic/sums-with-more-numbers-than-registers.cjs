// STATISTIC: ValuesSpilled >= 1
// More numbers with a fraction live at once than a processor has registers for them: some lie in memory between, and a sum or a product takes the first of its two from there. Each of them is used again behind, in another order.
'use strict';
function market(s, t) {
  const a0 = s[0] + 0.5, a1 = s[1] - 1.25, a2 = s[2] * 1.5, a3 = s[3] / 4, a4 = s[4] + t[0], a5 = s[5] - t[1], a6 = s[6] * t[2], a7 = s[7] + t[3] / 8;
  const b0 = t[4] * 2.5, b1 = t[5] - a0, b2 = t[6] + a1, b3 = t[7] * a2, b4 = a3 - b0, b5 = a4 * b1, b6 = a5 + b2, b7 = a6 - b3;
  const c0 = a7 * b4, c1 = b5 - a0, c2 = b6 * a1, c3 = b7 + a2, c4 = c0 - a3, c5 = c1 * 0.125, c6 = c2 + a4, c7 = c3 - a5;
  const d = a0 * c7 - a1 * c6 + a2 * c5 - a3 * c4 + a4 * c3 - a5 * c2 + a6 * c1 - a7 * c0;
  const e = b0 * c0 + b1 * c2 - b2 * c4 + b3 * c6 - b4 * c1 + b5 * c3 - b6 * c5 + b7 * c7;
  return (d - e) * 0.5 + (a0 + a1 + a2 + a3) * (b4 + b5 + b6 + b7) - (a4 - a5 + a6 - a7) * (b0 - b1 + b2 - b3) + c4 * c5 - c6 * c7;
}
function ladder(x) { let a = x, b = x + 1, c = x * 2, d = x / 3, e = x - 4, f = x * x, g = 5 / (x + 9), h = x * 0.1, i = a + d, j = b * c, k = e - f, l = g * h, m = a * e, n = b - g, o = c + h, p = d * f, q = i * j, r = k + l; for (let z = 0; z < 5; z++) { a = b * 0.5 + r; b = c - q * 1e-3; c = d + p; d = e * 0.25; e = f - o; f = g * n; g = h + m; h = i * 0.125; i = j - l; j = k * 1e-2; k = l + a; l = m - b; m = n * 0.5; n = o + c; o = p - d; p = q * 1e-4; q = r - e; r = a * 1e-5 + f; } return [r, a, q, b, p, c, o, d, n, e, m, f, l, g, k, h, j, i]; }
function apart(v, flag, call) { const a = v[0] * 1.1, b = v[1] * 1.2, c = v[2] * 1.3, d = v[3] * 1.4, e = v[4] * 1.5, f = v[5] * 1.6, g = v[6] * 1.7, h = v[7] * 1.8, i = a - h, j = b - g, k = c - f, l = d - e; const m = flag ? call(a, l) : i * j, n = k * l - m, o = a * n, p = h - o, q = Math.sqrt(Math.abs(p)) + b; return flag ? (a + b * c - d * e + f * g - h * i + j * k - l * m) * n - o * p + q : ((((((((((a - b) * c - d) * e - f) * g - h) * i - j) * k - l) * m - n) * o) - p) * q); }
const round = x => typeof x === 'number' ? (Object.is(x, -0) ? '-0' : x === Math.trunc(x) && Math.abs(x) < 1e15 ? x : x.toPrecision(12)) : String(x), told = run => { try { const v = run(); return Array.isArray(v) ? v.map(round).join(' ') : round(v); } catch (error) { return error.constructor.name; } };
const lists = { even: [1, 2, 3, 4, 5, 6, 7, 8], parts: [0.1, -0.2, 0.3, 1e3, -1e-3, 6.5, 7.75, 8.125], great: [1e200, 1e-200, 1e100, -1e100, 3, 2 ** 53, -(2 ** 53), 0.5], zero: [0, -0, 0, -0, 0, -0, 0, -0], nan: [1, NaN, 3, 4, 5, 6, 7, 8], far: [Infinity, 1, 2, 3, -Infinity, 5, 6, 7], hole: [1, , 3, 4, , 6, 7, 8], short: [1, 2, 3], text: ['1', 2, '3', 4, 5, 6, 7, 8], view: new Float32Array([0.1, 0.2, 0.3, 4, 5, 6, 7, 8]), bytes: new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]), object: [{ valueOf: () => 2.5 }, 1, 2, 3, 4, 5, 6, 7], big: [1n, 2, 3, 4, 5, 6, 7, 8] };
for (let k = 0; k < 150; k++) { market(lists.parts, lists.even); ladder(k / 8); apart(k & 1 ? lists.even : lists.parts, k & 2, Math.hypot); }
for (const name of Object.keys(lists)) console.log(name, told(() => market(lists[name], lists.parts)), told(() => market(lists.even, lists[name])), told(() => apart(lists[name], 0)), told(() => apart(lists[name], 1, Math.atan2)));
for (const x of [0, 1.5, -2.25, 1e10, NaN, '4', null, undefined, -0]) console.log(told(() => ladder(x)));
console.log(told(() => ladder(2n)), told(() => apart(lists.even, 1, (a, b) => { throw new RangeError(a + b); })), told(() => apart(lists.even, 1, () => 'x')), told(() => market(null, lists.even)));
let order = ''; const slow = k => ({ valueOf() { order += k; return k + 0.5; } }); console.log(told(() => market([0, 1, 2, 3, 4, 5, 6, 7].map(slow), lists.even)), order);
