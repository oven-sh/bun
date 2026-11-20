// STATISTIC: LargeLoopsOfElementsVersioned >= 3
// Large loops take elements of two unknown holders, chosen behind tests, and store sums of them into a view under a counter that the loop steps itself; the place in the holder is found by a division.
"use strict";
const show = list => Array.from(list, v => (v === undefined ? "_" : Object.is(v, -0) ? "-0" : typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v))).join(" ");
function thinned(from, weights, w, h, parts) {
  const out = new Uint8Array(parts * h * 3);
  let at = 0;
  for (let y = 0; y < h; y++) {
    for (let p = 0; p < parts; p++) {
      const first = Math.floor(p * w / parts), last = Math.max(first + 1, Math.floor((p + 1) * w / parts));
      let a = 0, b = 0, c = 0, total = 0;
      for (let x = first; x < last; x++) {
        const place = (y * w + x) * 3, weight = x < weights.length ? weights[x] : 1;
        const one = from[place], two = x & 1 ? from[place + 1] : weights[place % weights.length];
        a += one * weight; b += two * weight; c += (one > two ? one : from[place + 2]) * weight; total += weight;
      }
      out[at++] = a / total; out[at++] = b / total; out[at++] = c / total;
    }
  }
  return out;
}
function mixed(a, b, n, by) {
  const out = new Float32Array(n);
  let place = 0, carried = 0;
  for (let i = 0; i < n; i += 4) {
    const half = (i / by) | 0, near = half < a.length ? a[half] : b[half % b.length], far = i + 3 < a.length ? a[i + 3] : 0;
    const left = near > 10 ? near - far : b[(half + 1) % b.length] + far, right = carried > 100 ? a[i % a.length] : b[i % b.length];
    carried = carried * 0.5 + left;
    out[place] = left * 0.25 + right; out[place + 1] = left - right * 0.5; out[place + 2] = carried; out[place + 3] = near * far + (half & 1 ? left : right);
    place += 4;
  }
  return out;
}
function stepped(a, b, n) {
  const out = new Int32Array(n);
  let i = 0, at = 0, low = 0;
  while (at < n) {
    const u = a[i % a.length], v = i % 3 ? b[i % b.length] : a[(i + 1) % a.length], w = u < v ? u * 3 + v : v * 3 - u, x = b[(i / 2 | 0) % b.length];
    low = low < w ? low + 1 : w; out[at] = w + x; if (w > 40) out[at] -= x * 2; if (u === v) out[at] += low; out[at] ^= (x & 7) + (u & 3); at++;
    i += out[at - 1] & 1 ? 1 : 2;
  }
  return out;
}
const bytes = n => Uint8Array.from({ length: n }, (_, i) => i * 37 + 5), list = n => Array.from({ length: n }, (_, i) => (i * 29) % 61), doubles = n => Array.from({ length: n }, (_, i) => i * 1.25 - 3);
const holders = [bytes, list, doubles, n => Float64Array.from(doubles(n)), n => Uint8ClampedArray.from(list(n))];
for (let k = 0; k < 40; k++) { const a = holders[k % 5], b = holders[(k + 2) % 5]; thinned(a(72), b(8), 6, 4, 3); mixed(a(20), b(9), 16, 2); stepped(a(15), b(7), 20); }
for (const one of holders) for (const other of holders) console.log(one(1).constructor.name, other(1).constructor.name, show(thinned(one(72), other(8), 6, 4, 2)), "|", show(mixed(one(20), other(9), 16, 3)), "|", show(stepped(one(15), other(7), 14)));
for (const odd of [[], [1, , 3], ["4", null, 6], [NaN, -1, 2 ** 40], { length: 3, 0: 1, 1: 2, 2: 3 }, "123"]) { try { console.log(show(thinned(odd, odd, 2, 1, 1)), show(mixed(list(8), odd, 8, 2)), show(stepped(odd, list(5), 5))); } catch (error) { console.log(error.constructor.name); } }
