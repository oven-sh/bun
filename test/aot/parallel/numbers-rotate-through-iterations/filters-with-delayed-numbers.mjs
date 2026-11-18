// Long iterations hand numbers on as other numbers of the next one. Every small count ends the loop in front of, inside and behind a pair of iterations; what was handed on is read behind the loop.
const show = v => { let t = 0; for (let i = 0; i < v.length; i++) t = (Math.imul(t, 31) + (v[i] * 64 | 0)) | 0; return t; };
function pixels(v, w, n, k0, k1, d1, d2) {
  let at = 0, to = 0, p0 = 1, p1 = 2, p2 = 3, a0 = 0.5, a1 = -0, a2 = 1.5, b0 = NaN === k0 ? 1 : 0, b1 = 2, b2 = -3;
  for (let i = 0; i < n; i++) {
    const e = v[at], r0 = e & 255, r1 = e >> 8 & 255, r2 = e >>> 24;
    const o0 = r0 * k0 + p0 * k1 + a0 * d1 + b0 * d2, o1 = r1 * k0 + p1 * k1 + a1 * d1 + b1 * d2, o2 = r2 * k0 + p2 * k1 + a2 * d1 + b2 * d2;
    b0 = a0; b1 = a1; b2 = a2; a0 = o0; a1 = o1; a2 = o2; p0 = r0; p1 = r1; p2 = r2;
    w[to] = a0; w[to + 1] = a1; w[to + 2] = a2;
    at++; to += 3;
  }
  return [at, to, p0, p1, p2, a0, a1, a2, b0, b1, b2].join();
}
function back(v, w, n, k0, k1, d1, d2) {
  let at = n - 1, to = n * 2, r0 = 7, r1 = 9, p0 = 1, p1 = 2, a0 = 0.5, a1 = 1, b0 = 4, b1 = 2;
  for (let i = n - 1; i >= 0; i--) {
    const o0 = r0 * k0 + p0 * k1 + a0 * d1 + b0 * d2, o1 = r1 * k0 + p1 * k1 + a1 * d1 + b1 * d2;
    b0 = a0; b1 = a1; a0 = o0; a1 = o1; p0 = r0; p1 = r1;
    const e = v[at]; r0 = e & 255; r1 = e >>> 16;
    w[to] = ((w[to + 1] + a0) << 0) + ((w[to + 2] + a1) << 8);
    at--; to -= 2;
  }
  return [at, to, r0, r1, p0, p1, a0, a1, b0, b1].join();
}
function three(v, w, n, k0, k1, d1, d2) {
  let at = 0, p = 1, q = -1, a = 1, b = 2, c = 3, d = 4, e = 5, f = 6;
  for (let i = 0; i < n * 2; i += 2) {
    const x = v[at], o = x * k0 + p * k1 + a * d1 + b * d2 + c, u = x * k1 + q * k0 + d * d2 + e * d1 + f;
    c = b; b = a; a = o; f = e; e = d; d = u; p = x; q = x + 1;
    w[at] = o - u; at++;
  }
  return [at, p, q, a, b, c, d, e, f].join();
}
function swaps(v, n, k0, k1) {
  let a = 0, b = 1, c = 2, d = 3, s = 0;
  for (let i = 0; i < n; i++) {
    const x = v[i], t = a; a = b; b = t; const y = c * k0 + x * k1 + a; c = d; d = y * k1 + b * k0 - x; s += a * 3 + b * 5 - c * d + k0 * x + k1;
  }
  return [a, b, c, d, s].join();
}
function rows(v, w, width, height, k) {
  let at = 0, s = 0;
  for (let y = 0; y < height; y++) {
    let a = v[at] * k, b = a, p = v[at] & 15, g = a, h = b, q = 3, to = y;
    for (let x = 0; x < width; x++) {
      const e = v[at], r = e & 15, z = e >> 4 & 15, o = r * k + p * 0.25 + a * 0.5 + b * -0.125, u = z * k + q * 0.25 + g * 0.5 + h * -0.125;
      b = a; a = o; h = g; g = u; p = r; q = z; w[to] = o + u; s += o; at++; to += height;
    }
    s += a + b + g + h + p + q;
  }
  return s;
}
for (const Kind of [Uint32Array, Int32Array, Uint8Array, Float64Array]) {
  const make = n => new Kind(n).map((_, i) => Math.imul(i + 1, 2654435761));
  for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 33]) {
    const w = new Float32Array(120), x = new Uint32Array(120), y = new Float64Array(40), r = new Float64Array(64);
    console.log(Kind.name, n, pixels(make(40), w, n, 0.25, -0.5, 0.125, 0.0625), show(w), back(make(40), x, n, 0.5, 0.25, -0.75, 0.125), show(x));
    console.log(three(make(40), y, n, 1e-3, 0.5, 0.25, -1), show(y), swaps(make(40), n, 0.5, 2), rows(make(64), r, n & 7, 8, 0.75), show(r));
  }
}
for (const n of [38, 40, 41, 60]) console.log(n, pixels(new Int32Array(40), new Float32Array(119), n, 0.5, 0.5, 1, 1), back(new Int32Array(40), new Uint32Array(79), n, 0.5, 0.5, 1, 1), three(new Int32Array(40), new Float64Array(39), n, 1, 1, 1, 1));
for (const k of [NaN, Infinity, -0, 1e308]) console.log(k, pixels(new Int32Array(40).fill(-1), new Float32Array(120), 9, k, 1, 1, 1), back(new Int32Array(40).fill(-1), new Uint32Array(120), 9, k, 1, 1, 1), swaps(new Float64Array(9).fill(k), 9, k, 1));
for (const odd of [undefined, null, "3", { valueOf: () => 2 }, true]) console.log(pixels(new Int32Array(9).fill(5), new Float32Array(30), 9, odd, 1, odd, 1), swaps([1, odd, 3.5], 3, 1, 2), rows([1, 2, odd, 4], [], 2, 2, 0.5));
