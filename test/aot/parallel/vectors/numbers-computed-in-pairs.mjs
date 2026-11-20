const B = new DataView(new ArrayBuffer(8));
function bits(x) { if (x !== x) return "NaN"; B.setFloat64(0, x); return B.getUint32(0).toString(16) + "." + B.getUint32(4).toString(16); }
function show(v) { let t = 17; const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); const isFloat = v instanceof Float32Array || v instanceof Float64Array; for (let i = 0; i < v.length; i++) { const x = v[i]; t = isFloat && x !== x ? (Math.imul(t, 31) + 7) | 0 : t; } if (isFloat) { for (let i = 0; i < v.length; i++) { const x = v[i]; if (x === x) { B.setFloat64(0, x); t = (Math.imul(t, 31) + B.getInt32(0)) | 0; t = (Math.imul(t, 31) + B.getInt32(4)) | 0; } } } else for (let i = 0; i < u.length; i++) t = (Math.imul(t, 31) + u[i]) | 0; return v.length + ":" + t; }
let ticks = 0;
function tick(v, how) { ticks++; if (how === 1 && ticks === 3) v.fill(NaN); if (how === 2) v[ticks % v.length] = -0; }
function f2000_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = -0;
  let p0_1 = -0;
  let p1_0 = q * 1;
  let p1_1 = 0.1;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 0] * c0 + p0_0 * c1 - p1_0 * 1.75;
    const r1 = src[at + 1] * c0 + p0_1 * c1 - p1_1 * 1.75;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1].map(bits).join(" ");
}
{ const n = 3; const src = new Float64Array(Math.max(0, 2 * n)).map((_, i) => i * 1234567.25 - 5); const dst = new Uint8ClampedArray(Math.max(0, 2 * n + 3)); for (let k = 0; k < 3; k++) console.log(f2000_0(src, dst, k === 2 ? n >> 1 : n, 1e200, 0.25, 1/3, k + 0.5, 2), show(src), show(dst)); }
function f2000_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0;
  let p0_1 = 0;
  for (let i = 0; i < n; i += 2) {
    const r0 = src[at + 1] * 0 + p0_0 * c1;
    const r1 = src[at + 0] * 0 + p0_1 * c1;
    p0_0 = r0;
    p0_1 = r1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1].map(bits).join(" ");
}
{ const n = 2; const src = new Float32Array(Math.max(0, 2 * n)).map((_, i) => i === 4 ? Infinity : -i); const dst = src; for (let k = 0; k < 3; k++) console.log(f2000_1(src, dst, k === 2 ? n >> 1 : n, -0.3, 0.25, 1/3, k + 0.5, 0), show(src), show(dst)); }
function f2001_0(src, dst, n, c0, c1, c2, q, how) {
  let at = n - 1, to = 2 * (n - 1);
  let p0_0 = -0;
  let p0_1 = q;
  let p1_0 = 0.1;
  let p1_1 = 0.1;
  let w0 = 0;
  let w1 = 1;
  for (let i = n - 1; i >= 0; i -= 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const r0 = b0 * 1.75 + w0 * c1 - p0_0 * c1 + p1_0 * 1.75;
    const r1 = b1 * 1.75 + w1 * c1 - p0_1 * c1 + p1_1 * 1.75;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    w0 = b0;
    w1 = b1;
    at -= 1; to -= 2;
  }
  return [p0_0, p0_1, p1_0, p1_1].map(bits).join(" ") + " " + [w0, w1].join();
}
{ const n = 7; const src = new Int32Array(Math.max(0, n)).map((_, i) => i % 5 ? i : -i); const dst = new Uint8ClampedArray(Math.max(0, 2 * n + 3)); for (let k = 0; k < 3; k++) console.log(f2001_0(src, dst, k === 2 ? n >> 1 : n, 0.5, 2, 1/3, k + 0.5, 0), show(src), show(dst)); }
function f2001_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = -0;
  let p0_1 = -0;
  let p0_2 = src[0] * 0.5;
  let p0_3 = q * 4;
  let p0_4 = 0.1;
  let p0_5 = -0;
  let p1_0 = q;
  let p1_1 = 0;
  let p1_2 = q * 3;
  let p1_3 = src[0] * 0.5;
  let p1_4 = 0.1;
  let p1_5 = 0;
  let p2_0 = -0;
  let p2_1 = src[0] * 0.5;
  let p2_2 = q;
  let p2_3 = -0;
  let p2_4 = q;
  let p2_5 = 0.1;
  let w0 = n & 255;
  let w1 = 0;
  let w2 = 0;
  let w3 = 0;
  let w4 = 0;
  let w5 = n & 255;
  for (let i = 0; i < n; i += 1) {
    const b0 = (at * 3 + 0) & 65535;
    const b1 = (at * 4 + 1) & 65535;
    const b2 = (at * 5 + 2) & 255;
    const b3 = (at * 6 + 3) & 255;
    const b4 = (at * 7 + 4) & 65535;
    const b5 = (at * 8 + 5) & 255;
    const r0 = b0 * c0 + w0 * c1 + p0_0 * c1 - p1_0 * c2 + p2_0 * -0.25;
    const r1 = b1 * c0 + w1 * c1 + p0_1 * c1 - p1_1 * c2 + p2_1 * -0.25;
    const r2 = b2 * c0 + w2 * c1 + p0_2 * c1 - p1_2 * c2 + p2_2 * -0.25;
    const r3 = b3 * c0 + w3 * c1 + p0_3 * c1 - p1_3 * c2 + p2_3 * -0.25;
    const r4 = b4 * c0 + w4 * c1 + p0_4 * c1 - p1_4 * c2 + p2_4 * -0.25;
    const r5 = b5 * c0 + w5 * c1 + p0_5 * c1 - p1_5 * c2 + p2_5 * -0.25;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    dst[to + 4] = r4;
    dst[to + 5] = r5;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p2_2 = p1_2;
    p2_3 = p1_3;
    p2_4 = p1_4;
    p2_5 = p1_5;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p1_4 = p0_4;
    p1_5 = p0_5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    w3 = b3;
    w4 = b4;
    w5 = b5;
    at += 6; to += 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5, p1_0, p1_1, p1_2, p1_3, p1_4, p1_5, p2_0, p2_1, p2_2, p2_3, p2_4, p2_5].map(bits).join(" ") + " " + [w0, w1, w2, w3, w4, w5].join();
}
{ const n = 2; const src = new Float64Array(Math.max(0, 6 * n)).map((_, i) => Math.sin(i) * 1e3); const dst = new Uint8ClampedArray(Math.max(0, 6 * n)); for (let k = 0; k < 3; k++) console.log(f2001_1(src, dst, k === 2 ? n >> 1 : n, 0.5, -0, 0.125, k + 0.5, 0), show(src), show(dst)); }
function f2001_2(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = -0;
  for (let i = 0; i < n; i += 2) {
    const r0 = src[at + 0] * 1e300 + p0_0 * q*0.5;
    const r1 = src[at + 1] * 1e300 + p0_1 * q*0.5;
    p0_0 = r0;
    p0_1 = r1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1].map(bits).join(" ");
}
{ const n = 1; const src = new Float64Array(Math.max(0, 2 * n)).map((_, i) => Math.sin(i) * 1e3); const dst = new Int16Array(Math.max(0, 2 * n)); for (let k = 0; k < 3; k++) console.log(f2001_2(src, dst, k === 2 ? n >> 1 : n, -0.3, -0, 1/3, k + 0.5, 0), show(src), show(dst)); }
function f2002_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = -0;
  let p0_1 = -0;
  let p1_0 = -0;
  let p1_1 = 0;
  let p2_0 = 0.1;
  let p2_1 = 0;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 0] * c0 - p0_0 * c1 - p1_0 * 0 + p2_0 * c0;
    const r1 = src[at + 1] * c0 - p0_1 * c1 - p1_1 * 0 + p2_1 * c0;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1, p2_0, p2_1].map(bits).join(" ");
}
{ const n = 0; const src = new Float32Array(Math.max(0, 2 * n)).map((_, i) => i % 5 ? i : -i); const dst = new Float32Array(Math.max(0, 2 * n)); for (let k = 0; k < 3; k++) console.log(f2002_0(src, dst, k === 2 ? n >> 1 : n, 1e200, 2, 1/3, k + 0.5, 0), show(src), show(dst)); }
function f2002_1(src, dst, n, c0, c1, c2, q, how) {
  let at = n - 1, to = 3 * (n - 1);
  let p0_0 = q * 1;
  let p0_1 = src[0] * 0.5;
  let p0_2 = -0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const b2 = (word >> 16) & 255;
    const r0 = b0 * c0 + p0_0 * c1;
    const r1 = b1 * c0 + p0_1 * c1;
    const r2 = b2 * c0 + p0_2 * c1;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    at -= 1; to -= 3;
  }
  return [p0_0, p0_1, p0_2].map(bits).join(" ");
}
{ const n = 3; const src = new Int32Array(Math.max(0, n - 1)).map((_, i) => i % 5 ? i : -i); const dst = new Uint8ClampedArray(Math.max(0, 3 * n)); for (let k = 0; k < 3; k++) console.log(f2002_1(src, dst, k === 2 ? n >> 1 : n, 1e200, -0, 1/3, k + 0.5, 1), show(src), show(dst)); }
function f2002_2(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = -0;
  let p0_1 = q;
  let p0_2 = q;
  let p0_3 = q;
  let p1_0 = src[0] * 0.5;
  let p1_1 = q * 2;
  let p1_2 = 0;
  let p1_3 = src[0] * 0.5;
  let p2_0 = -0;
  let p2_1 = -0;
  let p2_2 = q;
  let p2_3 = 0.1;
  let w0 = 0;
  let w1 = 1;
  let w2 = 0;
  let w3 = 3;
  for (let i = 0; i < n; i += 1) {
    const b0 = (at * 3 + 0) & 65535;
    const b1 = (at * 4 + 1) & 255;
    const b2 = (at * 5 + 2) & 65535;
    const b3 = (at * 6 + 3) & 1023;
    const r0 = b0 * 0 + w0 * c1 + p0_0 * c1 + p1_0 * c2 + p2_0 * c0;
    const r1 = b1 * 0 + w1 * c1 + p0_1 * c1 + p1_1 * c2 + p2_1 * c0;
    const r2 = b2 * 0 + w2 * c1 + p0_2 * c1 + p1_2 * c2 + p2_2 * c0;
    const r3 = b3 * 0 + w3 * c1 + p0_3 * c1 + p1_3 * c2 + p2_3 * c0;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p2_2 = p1_2;
    p2_3 = p1_3;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    w3 = b3;
    at += 4; to += 4;
  }
  return [p0_0, p0_1, p0_2, p0_3, p1_0, p1_1, p1_2, p1_3, p2_0, p2_1, p2_2, p2_3].map(bits).join(" ") + " " + [w0, w1, w2, w3].join();
}
{ const n = 8; const src = new Float32Array(Math.max(0, 4 * n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Float32Array(Math.max(0, n)); for (let k = 0; k < 3; k++) console.log(f2002_2(src, dst, k === 2 ? n >> 1 : n, 0.5, 0.25, 1/3, k + 0.5, 1), show(src), show(dst)); }
function f2003_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 6 * (n - 1), to = 6 * (n - 1);
  let p0_0 = -0;
  let p0_1 = 0;
  let p0_2 = -0;
  let p0_3 = 0.1;
  let p0_4 = q * 5;
  let p0_5 = q;
  let p1_0 = q * 1;
  let p1_1 = 0.1;
  let p1_2 = q * 3;
  let p1_3 = 0.1;
  let p1_4 = -0;
  let p1_5 = 0;
  let p2_0 = 0;
  let p2_1 = -0;
  let p2_2 = src[0] * 0.5;
  let p2_3 = 0.1;
  let p2_4 = q * 5;
  let p2_5 = -0;
  let w0 = 0;
  let w1 = n & 255;
  let w2 = 0;
  let w3 = n & 255;
  let w4 = 4;
  let w5 = 5;
  for (let i = n - 1; i >= 0; i -= 1) {
    const b0 = (at * 3 + 0) & 65535;
    const b1 = (at * 4 + 1) & 65535;
    const b2 = (at * 5 + 2) & 65535;
    const b3 = (at * 6 + 3) & 255;
    const b4 = (at * 7 + 4) & 255;
    const b5 = (at * 8 + 5) & 1023;
    const r0 = b0 * c0 + w0 * c1 + p0_0 * c1 + p1_0 * c2 + p2_0 * c0;
    const r1 = b1 * c0 + w1 * c1 + p0_1 * c1 + p1_1 * c2 + p2_1 * c0;
    const r2 = b2 * c0 + w2 * c1 + p0_2 * c1 + p1_2 * c2 + p2_2 * c0;
    const r3 = b3 * c0 + w3 * c1 + p0_3 * c1 + p1_3 * c2 + p2_3 * c0;
    const r4 = b4 * c0 + w4 * c1 + p0_4 * c1 + p1_4 * c2 + p2_4 * c0;
    const r5 = b5 * c0 + w5 * c1 + p0_5 * c1 + p1_5 * c2 + p2_5 * c0;
    if (r0 > 1e9) tick(src, how);
    dst[to + 1] = r1;
    dst[to + 0] = r0;
    dst[to + 2] = r2;
    dst[to + 5] = r5;
    dst[to + 3] = r3;
    dst[to + 4] = r4;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p2_2 = p1_2;
    p2_3 = p1_3;
    p2_4 = p1_4;
    p2_5 = p1_5;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p1_4 = p0_4;
    p1_5 = p0_5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    w3 = b3;
    w4 = b4;
    w5 = b5;
    at -= 6; to -= 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5, p1_0, p1_1, p1_2, p1_3, p1_4, p1_5, p2_0, p2_1, p2_2, p2_3, p2_4, p2_5].map(bits).join(" ") + " " + [w0, w1, w2, w3, w4, w5].join();
}
{ const n = 100; const src = new Float32Array(Math.max(0, 6 * n)).map((_, i) => i % 5 ? i : -i); const dst = new Int16Array(Math.max(0, n)); for (let k = 0; k < 3; k++) console.log(f2003_0(src, dst, k === 2 ? n >> 1 : n, 0.5, 2, NaN, k + 0.5, 0), show(src), show(dst)); }
function f2004_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = q;
  let p1_0 = q * 1;
  let p1_1 = -0;
  let p2_0 = 0;
  let p2_1 = -0;
  let w0 = n & 255;
  let w1 = 0;
  for (let i = 0; i < n; i += 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const r0 = b0 * c0 + w0 * c1 + p0_0 * q + p1_0 * q*0.5 + p2_0 * 1/3;
    const r1 = b1 * c0 + w1 * c1 + p0_1 * q + p1_1 * q*0.5 + p2_1 * 1/3 + 1;
    dst[to + 1] = r1 + p0_1;
    dst[to + 0] = r0 + p0_0;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    w0 = b0;
    w1 = b1;
    at += 1; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1, p2_0, p2_1].map(bits).join(" ") + " " + [w0, w1].join();
}
{ const n = 1; const src = new Int32Array(Math.max(0, n + 2)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Uint8ClampedArray(Math.max(0, 2 * n + 3)); for (let k = 0; k < 3; k++) console.log(f2004_0(src, dst, k === 2 ? n >> 1 : n, 0.5, 2, 0.125, k + 0.5, 1), show(src), show(dst)); }
function f2004_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = q * 2;
  let p0_2 = q * 3;
  let p1_0 = 0.1;
  let p1_1 = q * 2;
  let p1_2 = src[0] * 0.5;
  for (let i = 0; i < n; i += 1) {
    const r0 = p0_0 * -1 - p0_0 * 0 + p1_0 * c2;
    const r1 = p0_1 * -1 - p0_1 * 0 + p1_1 * c2;
    const r2 = p0_2 * -1 - p0_2 * 0 + p1_2 * c2;
    if (r0 > 1e9) tick(src, how);
    if (r2 < -1e6) break;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    at += 3; to += 3;
  }
  return [p0_0, p0_1, p0_2, p1_0, p1_1, p1_2].map(bits).join(" ");
}
{ const n = 3; const src = new Float64Array(Math.max(0, 3 * n)).map((_, i) => i === 4 ? Infinity : -i); const dst = new Int16Array(Math.max(0, 3 * n)); for (let k = 0; k < 3; k++) console.log(f2004_1(src, dst, k === 2 ? n >> 1 : n, 1e200, 0.25, 0.125, k + 0.5, 1), show(src), show(dst)); }
function f2004_2(src, dst, n, c0, c1, c2, q, how) {
  let at = 4 * (n - 1), to = 4 * (n - 1);
  let p0_0 = q;
  let p0_1 = q * 2;
  let p0_2 = src[0] * 0.5;
  let p0_3 = 0;
  let p1_0 = src[0] * 0.5;
  let p1_1 = 0;
  let p1_2 = -0;
  let p1_3 = q;
  for (let i = n - 1; i >= 0; i -= 1) {
    const r0 = src[at + 0] * c0 + p0_0 * -0.25 - p1_0 * c2;
    const r1 = src[at + 1] * c0 + p0_1 * -0.25 - p1_1 * c2;
    const r2 = src[at + 2] * c0 + p0_2 * -0.25 - p1_2 * c2;
    const r3 = src[at + 3] * c0 + p0_3 * -0.25 - p1_3 * c2;
    dst[to + 2] = r2;
    dst[to + 1] = r1;
    dst[to + 3] = r3;
    dst[to + 0] = r0;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    at -= 4; to -= 4;
  }
  return [p0_0, p0_1, p0_2, p0_3, p1_0, p1_1, p1_2, p1_3].map(bits).join(" ");
}
{ const n = 100; const src = new Float64Array(Math.max(0, 4 * n)).map((_, i) => i * 1234567.25 - 5); const dst = new Int16Array(Math.max(0, 4 * n)); for (let k = 0; k < 3; k++) console.log(f2004_2(src, dst, k === 2 ? n >> 1 : n, 0.11, 0.25, 0.125, k + 0.5, 0), show(src), show(dst)); }
function f2005_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0;
  let p0_1 = -0;
  for (let i = 0; i < n; i += 2) {
    const r0 = src[at + 1] * q + p0_0 * c1;
    const r1 = src[at + 0] * q + p0_1 * c1;
    if (r1 < -1e6) break;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p0_0 = r0;
    p0_1 = r1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1].map(bits).join(" ");
}
{ const n = 0; const src = new Int32Array(Math.max(0, 2 * n)).map((_, i) => i === 4 ? Infinity : -i); const dst = new Int16Array(Math.max(0, 2 * n - 1)); for (let k = 0; k < 3; k++) console.log(f2005_0(src, dst, k === 2 ? n >> 1 : n, -0.3, 2, 0.125, k + 0.5, 2), show(src), show(dst)); }
function f2005_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = q;
  let p0_1 = 0.1;
  let p0_2 = q;
  let p0_3 = q * 4;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 0] * -1 + p0_0 * c1;
    const r1 = src[at + 1] * -1 + p0_1 * c1;
    const r2 = src[at + 2] * -1 + p0_2 * c1;
    const r3 = src[at + 3] * -1 + p0_3 * c1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    dst[to + 1] = r1;
    dst[to + 0] = r0;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    at += 4; to += 4;
  }
  return [p0_0, p0_1, p0_2, p0_3].map(bits).join(" ");
}
{ const n = 100; const src = new Float64Array(Math.max(0, 4 * n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Int16Array(Math.max(0, 4 * n)); for (let k = 0; k < 3; k++) console.log(f2005_1(src, dst, k === 2 ? n >> 1 : n, -0.3, 0.25, NaN, k + 0.5, 0), show(src), show(dst)); }
function f2006_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 4 * (n - 1), to = 4 * (n - 1);
  let p0_0 = q;
  let p0_1 = q * 2;
  let p0_2 = 0.1;
  let p0_3 = q;
  for (let i = n - 1; i >= 0; i -= 1) {
    const b0 = (at * 3 + 0) & 255;
    const b1 = (at * 4 + 1) & 255;
    const b2 = (at * 5 + 2) & 1023;
    const b3 = (at * 6 + 3) & 1023;
    const r0 = b0 * c0 + p0_0 * c1;
    const r1 = b1 * c0 + p0_1 * c1;
    const r2 = b2 * c0 + p0_2 * c1;
    const r3 = b3 * c0 + p0_3 * c1;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    at -= 4; to -= 4;
  }
  return [p0_0, p0_1, p0_2, p0_3].map(bits).join(" ");
}
{ const n = 1; const src = new Float32Array(Math.max(0, 4 * n)).map((_, i) => Math.sin(i) * 1e3); const dst = new Uint8ClampedArray(Math.max(0, 4 * n - 1)); for (let k = 0; k < 3; k++) console.log(f2006_0(src, dst, k === 2 ? n >> 1 : n, 1e200, -0, NaN, k + 0.5, 2), show(src), show(dst)); }
function f2006_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = q * 2;
  let p0_2 = src[0] * 0.5;
  let w0 = 0;
  let w1 = n & 255;
  let w2 = n & 255;
  for (let i = 0; i < n; i += 1) {
    const b0 = (at * 3 + 0) & 255;
    const b1 = (at * 4 + 1) & 65535;
    const b2 = (at * 5 + 2) & 255;
    const r0 = b0 * -0.25 + w0 * c1 - p0_0 * 1/3;
    const r1 = b1 * -0.25 + w1 * c1 - p0_1 * 1/3;
    const r2 = b2 * -0.25 + w2 * c1 - p0_2 * 1/3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    at += 3; to += 3;
  }
  return [p0_0, p0_1, p0_2].map(bits).join(" ") + " " + [w0, w1, w2].join();
}
{ const n = 1; const src = new Float64Array(Math.max(0, 3 * n)).map((_, i) => i === 4 ? Infinity : -i); const dst = new Float32Array(Math.max(0, 3 * n + 3)); for (let k = 0; k < 3; k++) console.log(f2006_1(src, dst, k === 2 ? n >> 1 : n, 1e200, -0, 0.125, k + 0.5, 1), show(src), show(dst)); }
function f2006_2(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = src[0] * 0.5;
  let p0_1 = q * 2;
  let p1_0 = -0;
  let p1_1 = 0;
  let p2_0 = src[0] * 0.5;
  let p2_1 = q * 2;
  let w0 = n & 255;
  let w1 = 0;
  for (let i = 0; i < n; i += 1) {
    const b0 = (at * 3 + 0) & 65535;
    const b1 = (at * 4 + 1) & 65535;
    const r0 = b0 * Infinity + w0 * c1 + p0_0 * c1 + p1_0 * c2 - p2_0 * -1;
    const r1 = b1 * Infinity + w1 * c1 + p0_1 * c1 + p1_1 * c2 - p2_1 * -1;
    dst[to + 0] = p0_0;
    dst[to + 1] = p0_1;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    w0 = b0;
    w1 = b1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1, p2_0, p2_1].map(bits).join(" ") + " " + [w0, w1].join();
}
{ const n = 7; const src = new Int32Array(Math.max(0, 2 * n)).map((_, i) => i * 1234567.25 - 5); const dst = new Uint8ClampedArray(Math.max(0, 2 * n)); for (let k = 0; k < 3; k++) console.log(f2006_2(src, dst, k === 2 ? n >> 1 : n, 0.5, 2, 1/3, k + 0.5, 2), show(src), show(dst)); }
function f2007_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 6 * (n - 1), to = 6 * (n - 1);
  let p0_0 = -0;
  let p0_1 = q * 2;
  let p0_2 = -0;
  let p0_3 = 0;
  let p0_4 = 0;
  let p0_5 = src[0] * 0.5;
  for (let i = n - 1; i >= 0; i -= 1) {
    const r0 = src[at + 0] * c0 + p0_0 * -0.25;
    const r1 = src[at + 1] * c0 + p0_1 * -0.25;
    const r2 = src[at + 2] * c0 + p0_2 * -0.25;
    const r3 = src[at + 3] * c0 + p0_3 * -0.25;
    const r4 = src[at + 4] * c0 + p0_4 * -0.25;
    const r5 = src[at + 5] * c0 + p0_5 * -0.25 + 1;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    dst[to + 4] = r4;
    dst[to + 5] = r5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    at -= 6; to -= 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5].map(bits).join(" ");
}
{ const n = 0; const src = new Float32Array(Math.max(0, 6 * n)).map((_, i) => i * 1234567.25 - 5); const dst = new Float64Array(Math.max(0, 6 * n)); for (let k = 0; k < 3; k++) console.log(f2007_0(src, dst, k === 2 ? n >> 1 : n, 0.11, 0.25, 0.125, k + 0.5, 2), show(src), show(dst)); }
function f2008_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = src[0] * 0.5;
  let p0_1 = q * 2;
  let p0_2 = -0;
  let p1_0 = q * 1;
  let p1_1 = q * 2;
  let p1_2 = q;
  let w0 = 0;
  let w1 = 0;
  let w2 = n & 255;
  for (let i = 0; i < n; i += 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >>> 8) & 255;
    const b2 = (word >>> 16) & 255;
    const r0 = b0 * 1.75 + w0 * c1 - p0_0 * c1 - p1_0 * c2;
    const r1 = b1 * 1.75 + w1 * c1 - p0_1 * c1 - p1_1 * c2;
    const r2 = b2 * 1.75 + w2 * c1 - p0_2 * c1 - p1_2 * c2;
    if (r0 > 1e9) tick(src, how);
    dst[to + 2] = r2;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    at += 1; to += 3;
  }
  return [p0_0, p0_1, p0_2, p1_0, p1_1, p1_2].map(bits).join(" ") + " " + [w0, w1, w2].join();
}
{ const n = 1; const src = new Int32Array(Math.max(0, n + 2)).map((_, i) => i % 5 ? i : -i); const dst = new Int16Array(Math.max(0, 3 * n)); for (let k = 0; k < 3; k++) console.log(f2008_0(src, dst, k === 2 ? n >> 1 : n, 0.5, -0, 0.125, k + 0.5, 0), show(src), show(dst)); }
function f2009_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = q * 1;
  let p0_1 = 0;
  let p0_2 = q * 3;
  let p0_3 = 0;
  let p0_4 = 0.1;
  let p0_5 = q * 6;
  let p1_0 = q * 1;
  let p1_1 = 0.1;
  let p1_2 = src[0] * 0.5;
  let p1_3 = 0;
  let p1_4 = q * 5;
  let p1_5 = q * 6;
  let p2_0 = q;
  let p2_1 = src[0] * 0.5;
  let p2_2 = 0.1;
  let p2_3 = src[0] * 0.5;
  let p2_4 = 0;
  let p2_5 = -0;
  for (let i = 0; i < n; i += 2) {
    const r0 = p0_0 * c0 + p0_0 * 0 + p1_0 * c2 - p2_0 * 1e300;
    const r1 = p0_1 * c0 + p0_1 * 0 + p1_1 * c2 - p2_1 * 1e300;
    const r2 = p0_2 * c0 + p0_2 * 0 + p1_2 * c2 - p2_2 * 1e300;
    const r3 = p0_3 * c0 + p0_3 * 0 + p1_3 * c2 - p2_3 * 1e300;
    const r4 = p0_4 * c0 + p0_4 * 0 + p1_4 * c2 - p2_4 * 1e300;
    const r5 = p0_5 * c0 + p0_5 * 0 + p1_5 * c2 - p2_5 * 1e300;
    dst[to + 0] = r0 + p0_0;
    dst[to + 1] = r1 + p0_1;
    dst[to + 2] = r2 + p0_2;
    dst[to + 3] = r3 + p0_3;
    dst[to + 4] = r4 + p0_4;
    dst[to + 5] = r5 + p0_5;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p2_2 = p1_2;
    p2_3 = p1_3;
    p2_4 = p1_4;
    p2_5 = p1_5;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p1_4 = p0_4;
    p1_5 = p0_5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    at += 6; to += 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5, p1_0, p1_1, p1_2, p1_3, p1_4, p1_5, p2_0, p2_1, p2_2, p2_3, p2_4, p2_5].map(bits).join(" ");
}
{ const n = 3; const src = new Float64Array(Math.max(0, 6 * n)).map((_, i) => i * 1234567.25 - 5); const dst = new Float32Array(Math.max(0, 6 * n)); for (let k = 0; k < 3; k++) console.log(f2009_0(src, dst, k === 2 ? n >> 1 : n, 0.11, -0, 1/3, k + 0.5, 1), show(src), show(dst)); }
function f2009_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = src[0] * 0.5;
  let p0_2 = 0.1;
  let p0_3 = src[0] * 0.5;
  let p0_4 = q * 5;
  let p0_5 = 0.1;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 0] * c0 + p0_0 * c1;
    const r1 = src[at + 1] * c0 + p0_1 * c1;
    const r2 = src[at + 2] * c0 + p0_2 * c1;
    const r3 = src[at + 3] * c0 + p0_3 * c1;
    const r4 = src[at + 4] * c0 + p0_4 * c1;
    const r5 = src[at + 5] * c0 + p0_5 * c1;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    dst[to + 4] = r4;
    dst[to + 5] = r5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    at += 6; to += 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5].map(bits).join(" ");
}
{ const n = 3; const src = new Uint8ClampedArray(Math.max(0, 6 * n)).map((_, i) => i % 5 ? i : -i); const dst = new Int16Array(Math.max(0, 6 * n)); for (let k = 0; k < 3; k++) console.log(f2009_1(src, dst, k === 2 ? n >> 1 : n, 0.11, -0, NaN, k + 0.5, 0), show(src), show(dst)); }
function f2010_0(src, dst, n, c0, c1, c2, q, how) {
  let at = n - 1, to = 4 * (n - 1);
  let p0_0 = q;
  let p0_1 = -0;
  let p0_2 = q * 3;
  let p0_3 = q * 4;
  let p1_0 = 0.1;
  let p1_1 = 0.1;
  let p1_2 = q;
  let p1_3 = q * 4;
  let w0 = 0;
  let w1 = 0;
  let w2 = 0;
  let w3 = n & 255;
  for (let i = n - 1; i >= 0; i -= 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const b2 = (word >> 16) & 255;
    const b3 = (word >>> 24) & 255;
    const r0 = b0 * c0 + w0 * c1 + p0_0 * c1 + p1_0 * c2;
    const r1 = b1 * c0 + w1 * c1 + p0_1 * c1 + p1_1 * c2;
    const r2 = b2 * c0 + w2 * c1 + p0_2 * c1 + p1_2 * c2;
    const r3 = b3 * c0 + w3 * c1 + p0_3 * c1 + p1_3 * c2 + 1;
    if (r0 > 1e9) tick(src, how);
    if (r3 < -1e6) break;
    dst[to + 3] = p0_3;
    dst[to + 1] = p0_1;
    dst[to + 0] = p0_0;
    dst[to + 2] = p0_2;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    w3 = b3;
    at -= 1; to -= 4;
  }
  return [p0_0, p0_1, p0_2, p0_3, p1_0, p1_1, p1_2, p1_3].map(bits).join(" ") + " " + [w0, w1, w2, w3].join();
}
{ const n = 8; const src = new Int32Array(Math.max(0, n)).map((_, i) => i * 1234567.25 - 5); const dst = new Int16Array(Math.max(0, 4 * n)); for (let k = 0; k < 3; k++) console.log(f2010_0(src, dst, k === 2 ? n >> 1 : n, 0.5, 0.25, 0.125, k + 0.5, 2), show(src), show(dst)); }
function f2011_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = q;
  let p0_1 = -0;
  let p0_2 = 0.1;
  let p1_0 = q * 1;
  let p1_1 = 0.1;
  let p1_2 = q * 3;
  let p2_0 = 0;
  let p2_1 = 0;
  let p2_2 = src[0] * 0.5;
  let w0 = n & 255;
  let w1 = 1;
  let w2 = n & 255;
  for (let i = 0; i < n; i += 2) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const b2 = (word >> 16) & 255;
    const r0 = b0 * c0 + w0 * c1 + p0_0 * c1 + p1_0 * 1e300 + p2_0 * c0;
    const r1 = b1 * c0 + w1 * c1 + p0_1 * c1 + p1_1 * 1e300 + p2_1 * c0;
    const r2 = b2 * c0 + w2 * c1 + p0_2 * c1 + p1_2 * 1e300 + p2_2 * c0 + 1;
    dst[to + 0] = p0_0;
    dst[to + 1] = p0_1;
    dst[to + 2] = p0_2;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p2_2 = p1_2;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    at += 1; to += 3;
  }
  return [p0_0, p0_1, p0_2, p1_0, p1_1, p1_2, p2_0, p2_1, p2_2].map(bits).join(" ") + " " + [w0, w1, w2].join();
}
{ const n = 33; const src = new Uint32Array(Math.max(0, n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Float32Array(Math.max(0, 3 * n)); for (let k = 0; k < 3; k++) console.log(f2011_0(src, dst, k === 2 ? n >> 1 : n, 0.11, -0, NaN, k + 0.5, 1), show(src), show(dst)); }
function f2011_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = src[0] * 0.5;
  let p0_2 = src[0] * 0.5;
  let p0_3 = q;
  let p0_4 = -0;
  let p0_5 = 0;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 0] * c0 - p0_0 * -0.25;
    const r1 = src[at + 1] * c0 - p0_1 * -0.25;
    const r2 = src[at + 2] * c0 - p0_2 * -0.25;
    const r3 = src[at + 3] * c0 - p0_3 * -0.25;
    const r4 = src[at + 4] * c0 - p0_4 * -0.25;
    const r5 = src[at + 5] * c0 - p0_5 * -0.25;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    at += 6; to += 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5].map(bits).join(" ");
}
{ const n = 100; const src = new Float64Array(Math.max(0, 6 * n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Float32Array(Math.max(0, 6 * n)); for (let k = 0; k < 3; k++) console.log(f2011_1(src, dst, k === 2 ? n >> 1 : n, -0.3, 0.25, 1/3, k + 0.5, 2), show(src), show(dst)); }
function f2011_2(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = src[0] * 0.5;
  let p0_1 = q * 2;
  let p1_0 = 0.1;
  let p1_1 = 0;
  let w0 = 0;
  let w1 = n & 255;
  for (let i = 0; i < n; i += 1) {
    const b0 = (at * 3 + 0) & 65535;
    const b1 = (at * 4 + 1) & 1023;
    const r0 = b0 * q*0.5 + w0 * c1 + p0_0 * 1/3 + p1_0 * c2;
    const r1 = b1 * q*0.5 + w1 * c1 + p0_1 * 1/3 + p1_1 * c2;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    w0 = b0;
    w1 = b1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1].map(bits).join(" ") + " " + [w0, w1].join();
}
{ const n = 0; const src = new Float64Array(Math.max(0, 2 * n)).map((_, i) => i * 1234567.25 - 5); const dst = new Float64Array(Math.max(0, n)); for (let k = 0; k < 3; k++) console.log(f2011_2(src, dst, k === 2 ? n >> 1 : n, 0.5, 2, 0.125, k + 0.5, 1), show(src), show(dst)); }
function f2012_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = q;
  let p0_2 = 0.1;
  let p0_3 = -0;
  let p1_0 = q;
  let p1_1 = 0.1;
  let p1_2 = src[0] * 0.5;
  let p1_3 = q * 4;
  let w0 = n & 255;
  let w1 = 1;
  let w2 = n & 255;
  let w3 = 3;
  for (let i = 0; i < n; i += 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >>> 8) & 255;
    const b2 = (word >> 16) & 255;
    const b3 = (word >>> 24) & 255;
    const r0 = b0 * c0 + w0 * c1 - p0_0 / c1 + p1_0 * c2;
    const r1 = b1 * c0 + w1 * c1 - p0_1 / c1 + p1_1 * c2;
    const r2 = b2 * c0 + w2 * c1 - p0_2 / c1 + p1_2 * c2;
    const r3 = b3 * c0 + w3 * c1 - p0_3 / c1 + p1_3 * c2;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    w3 = b3;
    at += 1; to += 4;
  }
  return [p0_0, p0_1, p0_2, p0_3, p1_0, p1_1, p1_2, p1_3].map(bits).join(" ") + " " + [w0, w1, w2, w3].join();
}
{ const n = 8; const src = new Int32Array(Math.max(0, n - 1)).map((_, i) => Math.sin(i) * 1e3); const dst = new Uint8ClampedArray(Math.max(0, n)); for (let k = 0; k < 3; k++) console.log(f2012_0(src, dst, k === 2 ? n >> 1 : n, -0.3, 0.25, 1/3, k + 0.5, 1), show(src), show(dst)); }
function f2013_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = src[0] * 0.5;
  let p0_1 = 0;
  let p1_0 = 0;
  let p1_1 = 0.1;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 0] * c0 + p0_0 * q*0.5 + p1_0 * c2;
    const r1 = src[at + 1] * c0 + p0_1 * q*0.5 + p1_1 * c2;
    if (r0 > 1e9) tick(src, how);
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1].map(bits).join(" ");
}
{ const n = 8; const src = new Float64Array(Math.max(0, 2 * n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Uint8ClampedArray(Math.max(0, 2 * n + 3)); for (let k = 0; k < 3; k++) console.log(f2013_0(src, dst, k === 2 ? n >> 1 : n, -0.3, -0, NaN, k + 0.5, 2), show(src), show(dst)); }
function f2013_1(src, dst, n, c0, c1, c2, q, how) {
  let at = n - 1, to = 4 * (n - 1);
  let p0_0 = src[0] * 0.5;
  let p0_1 = 0.1;
  let p0_2 = q * 3;
  let p0_3 = q * 4;
  let p1_0 = -0;
  let p1_1 = q;
  let p1_2 = 0;
  let p1_3 = src[0] * 0.5;
  let w0 = n & 255;
  let w1 = 1;
  let w2 = 0;
  let w3 = 3;
  for (let i = n - 1; i >= 0; i -= 2) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >>> 8) & 255;
    const b2 = (word >> 16) & 255;
    const b3 = (word >> 24) & 255;
    const r0 = b0 * q*0.5 + w0 * c1 + p0_0 * -0.25 + p1_0 * 1e300;
    const r1 = b1 * q*0.5 + w1 * c1 + p0_1 * -0.25 + p1_1 * 1e300;
    const r2 = b2 * q*0.5 + w2 * c1 + p0_2 * -0.25 + p1_2 * 1e300;
    const r3 = b3 * q*0.5 + w3 * c1 + p0_3 * -0.25 + p1_3 * 1e300;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 0] = r0;
    dst[to + 3] = r3;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    w3 = b3;
    at -= 1; to -= 4;
  }
  return [p0_0, p0_1, p0_2, p0_3, p1_0, p1_1, p1_2, p1_3].map(bits).join(" ") + " " + [w0, w1, w2, w3].join();
}
{ const n = 2; const src = new Int32Array(Math.max(0, n - 1)).map((_, i) => i === 4 ? Infinity : -i); const dst = new Uint8ClampedArray(Math.max(0, 4 * n)); for (let k = 0; k < 3; k++) console.log(f2013_1(src, dst, k === 2 ? n >> 1 : n, -0.3, -0, 1/3, k + 0.5, 2), show(src), show(dst)); }
function f2014_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = -0;
  let p0_1 = 0;
  let p0_2 = 0;
  let p1_0 = q;
  let p1_1 = q;
  let p1_2 = src[0] * 0.5;
  let w0 = 0;
  let w1 = n & 255;
  let w2 = 2;
  for (let i = 0; i < n; i += 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const b2 = (word >> 16) & 255;
    const r0 = b0 * q + w0 * c1 + p0_0 * 1/3 - p1_0 * Infinity;
    const r1 = b1 * q + w1 * c1 + p0_1 * 1/3 - p1_1 * Infinity;
    const r2 = b2 * q + w2 * c1 + p0_2 * 1/3 - p1_2 * Infinity;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    at += 1; to += 3;
  }
  return [p0_0, p0_1, p0_2, p1_0, p1_1, p1_2].map(bits).join(" ") + " " + [w0, w1, w2].join();
}
{ const n = 7; const src = new Uint32Array(Math.max(0, n)).map((_, i) => i === 4 ? Infinity : -i); const dst = new Int16Array(Math.max(0, 3 * n)); for (let k = 0; k < 3; k++) console.log(f2014_0(src, dst, k === 2 ? n >> 1 : n, 0.11, 2, 0.125, k + 0.5, 0), show(src), show(dst)); }
function f2014_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0;
  let p0_1 = src[0] * 0.5;
  for (let i = 0; i < n; i += 2) {
    const b0 = (at * 3 + 0) & 1023;
    const b1 = (at * 4 + 1) & 65535;
    const r0 = b0 * -1 - p0_0 * 1.75;
    const r1 = b1 * -1 - p0_1 * 1.75;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p0_0 = r0;
    p0_1 = r1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1].map(bits).join(" ");
}
{ const n = 2; const src = new Uint8ClampedArray(Math.max(0, 2 * n)).map((_, i) => i % 5 ? i : -i); const dst = new Float32Array(Math.max(0, 2 * n)); for (let k = 0; k < 3; k++) console.log(f2014_1(src, dst, k === 2 ? n >> 1 : n, 1e200, 2, NaN, k + 0.5, 1), show(src), show(dst)); }
function f2015_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = q * 1;
  let p0_1 = src[0] * 0.5;
  let p1_0 = q * 1;
  let p1_1 = 0;
  let p2_0 = -0;
  let p2_1 = 0;
  let w0 = n & 255;
  let w1 = n & 255;
  for (let i = 0; i < n; i += 1) {
    const b0 = (at * 3 + 0) & 1023;
    const b1 = (at * 4 + 1) & 1023;
    const r0 = b0 * c0 + w0 * c1 + p0_0 * c1 + p1_0 / c2 + p2_0 * Infinity;
    const r1 = b1 * c0 + w1 * c1 + p0_1 * c1 + p1_1 / c2 + p2_1 * Infinity;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    w0 = b0;
    w1 = b1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1, p2_0, p2_1].map(bits).join(" ") + " " + [w0, w1].join();
}
{ const n = 100; const src = new Float64Array(Math.max(0, 2 * n)).map((_, i) => i * 1234567.25 - 5); const dst = new Float32Array(Math.max(0, n)); for (let k = 0; k < 3; k++) console.log(f2015_0(src, dst, k === 2 ? n >> 1 : n, 0.5, -0, 0.125, k + 0.5, 1), show(src), show(dst)); }
function f2015_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = src[0] * 0.5;
  let p0_1 = 0.1;
  let p1_0 = q;
  let p1_1 = q;
  let p2_0 = 0.1;
  let p2_1 = -0;
  for (let i = 0; i < n; i += 2) {
    const r0 = src[at + 0] * c0 + p0_0 * 0 + p1_0 * c2 + p2_0 * 1/3;
    const r1 = src[at + 1] * c0 + p0_1 * 0 + p1_1 * c2 + p2_1 * 1/3;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1, p2_0, p2_1].map(bits).join(" ");
}
{ const n = 1; const src = new Float32Array(Math.max(0, 2 * n)).map((_, i) => i % 5 ? i : -i); const dst = new Float32Array(Math.max(0, n)); for (let k = 0; k < 3; k++) console.log(f2015_1(src, dst, k === 2 ? n >> 1 : n, 0.5, 0.25, 1/3, k + 0.5, 1), show(src), show(dst)); }
function f2015_2(src, dst, n, c0, c1, c2, q, how) {
  let at = n - 1, to = 2 * (n - 1);
  let p0_0 = 0.1;
  let p0_1 = q * 2;
  let p1_0 = 0;
  let p1_1 = src[0] * 0.5;
  let w0 = 0;
  let w1 = n & 255;
  for (let i = n - 1; i >= 0; i -= 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const r0 = b0 * q + w0 * c1 + p0_0 * c1 + p1_0 * c2;
    const r1 = b1 * q + w1 * c1 + p0_1 * c1 + p1_1 * c2 + 1;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    w0 = b0;
    w1 = b1;
    at -= 1; to -= 2;
  }
  return [p0_0, p0_1, p1_0, p1_1].map(bits).join(" ") + " " + [w0, w1].join();
}
{ const n = 8; const src = new Int32Array(Math.max(0, n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Float32Array(Math.max(0, 2 * n + 3)); for (let k = 0; k < 3; k++) console.log(f2015_2(src, dst, k === 2 ? n >> 1 : n, 0.5, -0, NaN, k + 0.5, 1), show(src), show(dst)); }
function f2016_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = 0.1;
  let p0_2 = src[0] * 0.5;
  let p0_3 = -0;
  let p1_0 = 0;
  let p1_1 = src[0] * 0.5;
  let p1_2 = src[0] * 0.5;
  let p1_3 = q * 4;
  let p2_0 = q;
  let p2_1 = -0;
  let p2_2 = q * 3;
  let p2_3 = src[0] * 0.5;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 3] * q + p0_0 * c1 + p1_0 * 1.75 - p2_0 * 1e300;
    const r1 = src[at + 1] * q + p0_1 * c1 + p1_1 * 1.75 - p2_1 * 1e300;
    const r2 = src[at + 2] * q + p0_2 * c1 + p1_2 * 1.75 - p2_2 * 1e300;
    const r3 = src[at + 0] * q + p0_3 * c1 + p1_3 * 1.75 - p2_3 * 1e300;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p2_2 = p1_2;
    p2_3 = p1_3;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    at += 4; to += 4;
  }
  return [p0_0, p0_1, p0_2, p0_3, p1_0, p1_1, p1_2, p1_3, p2_0, p2_1, p2_2, p2_3].map(bits).join(" ");
}
{ const n = 7; const src = new Float32Array(Math.max(0, 4 * n)).map((_, i) => i % 5 ? i : -i); const dst = new Float32Array(Math.max(0, 4 * n - 1)); for (let k = 0; k < 3; k++) console.log(f2016_0(src, dst, k === 2 ? n >> 1 : n, -0.3, 0.25, NaN, k + 0.5, 1), show(src), show(dst)); }
function f2016_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = q;
  let p0_1 = -0;
  let p0_2 = q;
  let p0_3 = q * 4;
  let p0_4 = 0.1;
  let p0_5 = q * 6;
  for (let i = 0; i < n; i += 1) {
    const r0 = p0_0 * c0 + p0_0 * c1;
    const r1 = p0_1 * c0 + p0_1 * c1;
    const r2 = p0_2 * c0 + p0_2 * c1;
    const r3 = p0_3 * c0 + p0_3 * c1;
    const r4 = p0_4 * c0 + p0_4 * c1;
    const r5 = p0_5 * c0 + p0_5 * c1;
    if (r5 < -1e6) break;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    dst[to + 4] = r4;
    dst[to + 5] = r5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    at += 6; to += 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5].map(bits).join(" ");
}
{ const n = 1; const src = new Float32Array(Math.max(0, 6 * n)).map((_, i) => i * 1234567.25 - 5); const dst = new Uint8ClampedArray(Math.max(0, n)); for (let k = 0; k < 3; k++) console.log(f2016_1(src, dst, k === 2 ? n >> 1 : n, -0.3, 2, 0.125, k + 0.5, 0), show(src), show(dst)); }
function f2016_2(src, dst, n, c0, c1, c2, q, how) {
  let at = n - 1, to = 6 * (n - 1);
  let p0_0 = 0.1;
  let p0_1 = q;
  let p0_2 = q;
  let p0_3 = 0;
  let p0_4 = src[0] * 0.5;
  let p0_5 = 0.1;
  let p1_0 = src[0] * 0.5;
  let p1_1 = q;
  let p1_2 = q;
  let p1_3 = q * 4;
  let p1_4 = q;
  let p1_5 = 0.1;
  let w0 = n & 255;
  let w1 = 1;
  let w2 = 0;
  let w3 = 3;
  let w4 = 4;
  let w5 = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const b2 = (word >>> 16) & 255;
    const b3 = (word >>> 24) & 255;
    const b4 = word & 255;
    const b5 = (word >> 8) & 255;
    const r0 = b0 * -0.25 + w0 * c1 + p0_0 * c1 + p1_0 * c2;
    const r1 = b1 * -0.25 + w1 * c1 + p0_1 * c1 + p1_1 * c2;
    const r2 = b2 * -0.25 + w2 * c1 + p0_2 * c1 + p1_2 * c2;
    const r3 = b3 * -0.25 + w3 * c1 + p0_3 * c1 + p1_3 * c2;
    const r4 = b4 * -0.25 + w4 * c1 + p0_4 * c1 + p1_4 * c2;
    const r5 = b5 * -0.25 + w5 * c1 + p0_5 * c1 + p1_5 * c2;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    dst[to + 4] = r4;
    dst[to + 5] = r5;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p1_4 = p0_4;
    p1_5 = p0_5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    w3 = b3;
    w4 = b4;
    w5 = b5;
    at -= 1; to -= 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5, p1_0, p1_1, p1_2, p1_3, p1_4, p1_5].map(bits).join(" ") + " " + [w0, w1, w2, w3, w4, w5].join();
}
{ const n = 100; const src = new Int32Array(Math.max(0, n + 2)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Int16Array(Math.max(0, 6 * n - 1)); for (let k = 0; k < 3; k++) console.log(f2016_2(src, dst, k === 2 ? n >> 1 : n, 0.5, -0, NaN, k + 0.5, 0), show(src), show(dst)); }
function f2017_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = src[0] * 0.5;
  let p0_1 = q;
  let p0_2 = 0;
  let p0_3 = 0;
  let p1_0 = -0;
  let p1_1 = q;
  let p1_2 = q;
  let p1_3 = q;
  for (let i = 0; i < n; i += 2) {
    const r0 = src[at + 3] * c0 - p0_0 * -0.25 + p1_0 * Infinity;
    const r1 = src[at + 1] * c0 - p0_1 * -0.25 + p1_1 * Infinity;
    const r2 = src[at + 2] * c0 - p0_2 * -0.25 + p1_2 * Infinity;
    const r3 = src[at + 0] * c0 - p0_3 * -0.25 + p1_3 * Infinity;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    at += 4; to += 4;
  }
  return [p0_0, p0_1, p0_2, p0_3, p1_0, p1_1, p1_2, p1_3].map(bits).join(" ");
}
{ const n = 7; const src = new Float64Array(Math.max(0, 4 * n)).map((_, i) => Math.sin(i) * 1e3); const dst = new Float32Array(Math.max(0, 4 * n)); for (let k = 0; k < 3; k++) console.log(f2017_0(src, dst, k === 2 ? n >> 1 : n, 0.11, 0.25, NaN, k + 0.5, 2), show(src), show(dst)); }
function f2018_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 2 * (n - 1), to = 2 * (n - 1);
  let p0_0 = src[0] * 0.5;
  let p0_1 = q * 2;
  for (let i = n - 1; i >= 0; i -= 1) {
    const r0 = src[at + 1] * q*0.5 + p0_0 * 0.5;
    const r1 = src[at + 0] * q*0.5 + p0_1 * 0.5;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p0_0 = r0;
    p0_1 = r1;
    at -= 2; to -= 2;
  }
  return [p0_0, p0_1].map(bits).join(" ");
}
{ const n = 33; const src = new Float32Array(Math.max(0, 2 * n)).map((_, i) => Math.sin(i) * 1e3); const dst = new Float32Array(Math.max(0, 2 * n)); for (let k = 0; k < 3; k++) console.log(f2018_0(src, dst, k === 2 ? n >> 1 : n, 1e200, 2, 1/3, k + 0.5, 0), show(src), show(dst)); }
function f2018_1(src, dst, n, c0, c1, c2, q, how) {
  let at = n - 1, to = 4 * (n - 1);
  let p0_0 = src[0] * 0.5;
  let p0_1 = src[0] * 0.5;
  let p0_2 = src[0] * 0.5;
  let p0_3 = 0;
  let p1_0 = src[0] * 0.5;
  let p1_1 = q;
  let p1_2 = -0;
  let p1_3 = 0.1;
  let p2_0 = -0;
  let p2_1 = 0;
  let p2_2 = src[0] * 0.5;
  let p2_3 = 0.1;
  let w0 = n & 255;
  let w1 = 0;
  let w2 = 0;
  let w3 = 3;
  for (let i = n - 1; i >= 0; i -= 2) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const b2 = (word >> 16) & 255;
    const b3 = (word >> 24) & 255;
    const r0 = b0 * c0 + w0 * c1 + p0_0 * c1 + p1_0 * c2 + p2_0 * 1.75;
    const r1 = b1 * c0 + w1 * c1 + p0_1 * c1 + p1_1 * c2 + p2_1 * 1.75;
    const r2 = b2 * c0 + w2 * c1 + p0_2 * c1 + p1_2 * c2 + p2_2 * 1.75;
    const r3 = b3 * c0 + w3 * c1 + p0_3 * c1 + p1_3 * c2 + p2_3 * 1.75;
    dst[to + 3] = r3;
    dst[to + 2] = r2;
    dst[to + 1] = r1;
    dst[to + 0] = r0;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p2_2 = p1_2;
    p2_3 = p1_3;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    w3 = b3;
    at -= 1; to -= 4;
  }
  return [p0_0, p0_1, p0_2, p0_3, p1_0, p1_1, p1_2, p1_3, p2_0, p2_1, p2_2, p2_3].map(bits).join(" ") + " " + [w0, w1, w2, w3].join();
}
{ const n = 100; const src = new Int32Array(Math.max(0, n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Float64Array(Math.max(0, 4 * n)); for (let k = 0; k < 3; k++) console.log(f2018_1(src, dst, k === 2 ? n >> 1 : n, 1e200, -0, 1/3, k + 0.5, 1), show(src), show(dst)); }
function f2018_2(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = src[0] * 0.5;
  let p0_1 = 0;
  let p1_0 = 0.1;
  let p1_1 = src[0] * 0.5;
  let p2_0 = src[0] * 0.5;
  let p2_1 = -0;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 0] / c0 + p0_0 * q*0.5 + p1_0 * 1e300 + p2_0 * c0;
    const r1 = src[at + 1] / c0 + p0_1 * q*0.5 + p1_1 * 1e300 + p2_1 * c0;
    dst[to + 0] = r0 + p0_0;
    dst[to + 1] = r1 + p0_1;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1, p2_0, p2_1].map(bits).join(" ");
}
{ const n = 7; const src = new Float32Array(Math.max(0, 2 * n)).map((_, i) => i % 5 ? i : -i); const dst = new Float64Array(Math.max(0, 2 * n + 3)); for (let k = 0; k < 3; k++) console.log(f2018_2(src, dst, k === 2 ? n >> 1 : n, 0.5, 0.25, 1/3, k + 0.5, 1), show(src), show(dst)); }
function f2019_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = -0;
  let p0_1 = 0.1;
  let p1_0 = q * 1;
  let p1_1 = q;
  for (let i = 0; i < n; i += 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const r0 = b0 * c0 + p0_0 * c1 + p1_0 * c2;
    const r1 = b1 * c0 + p0_1 * c1 + p1_1 * c2;
    if (r0 > 1e9) tick(src, how);
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    at += 1; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1].map(bits).join(" ");
}
{ const n = 0; const src = new Uint32Array(Math.max(0, n + 2)).map((_, i) => i * 1234567.25 - 5); const dst = new Float32Array(Math.max(0, n)); for (let k = 0; k < 3; k++) console.log(f2019_0(src, dst, k === 2 ? n >> 1 : n, 1e200, -0, 1/3, k + 0.5, 1), show(src), show(dst)); }
function f2020_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = q;
  let p0_1 = q;
  let p0_2 = 0.1;
  let w0 = n & 255;
  let w1 = 0;
  let w2 = 2;
  for (let i = 0; i < n; i += 1) {
    const b0 = (at * 3 + 0) & 1023;
    const b1 = (at * 4 + 1) & 255;
    const b2 = (at * 5 + 2) & 65535;
    const r0 = b0 * 1/3 + w0 * c1 - p0_0 * c1;
    const r1 = b1 * 1/3 + w1 * c1 - p0_1 * c1;
    const r2 = b2 * 1/3 + w2 * c1 - p0_2 * c1;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    at += 3; to += 3;
  }
  return [p0_0, p0_1, p0_2].map(bits).join(" ") + " " + [w0, w1, w2].join();
}
{ const n = 2; const src = new Float64Array(Math.max(0, 3 * n)).map((_, i) => i === 4 ? Infinity : -i); const dst = new Int16Array(Math.max(0, 3 * n)); for (let k = 0; k < 3; k++) console.log(f2020_0(src, dst, k === 2 ? n >> 1 : n, 0.11, 2, NaN, k + 0.5, 2), show(src), show(dst)); }
function f2020_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = 0.1;
  let p0_2 = q * 3;
  let p0_3 = -0;
  let p0_4 = q;
  let p0_5 = src[0] * 0.5;
  let p1_0 = 0.1;
  let p1_1 = -0;
  let p1_2 = src[0] * 0.5;
  let p1_3 = 0;
  let p1_4 = 0;
  let p1_5 = q;
  let w0 = n & 255;
  let w1 = n & 255;
  let w2 = n & 255;
  let w3 = n & 255;
  let w4 = 0;
  let w5 = n & 255;
  for (let i = 0; i < n; i += 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const b2 = (word >> 16) & 255;
    const b3 = (word >> 24) & 255;
    const b4 = word & 255;
    const b5 = (word >> 8) & 255;
    const r0 = b0 * c0 + w0 * c1 - p0_0 * c1 + p1_0 * c2;
    const r1 = b1 * c0 + w1 * c1 - p0_1 * c1 + p1_1 * c2;
    const r2 = b2 * c0 + w2 * c1 - p0_2 * c1 + p1_2 * c2;
    const r3 = b3 * c0 + w3 * c1 - p0_3 * c1 + p1_3 * c2;
    const r4 = b4 * c0 + w4 * c1 - p0_4 * c1 + p1_4 * c2;
    const r5 = b5 * c0 + w5 * c1 - p0_5 * c1 + p1_5 * c2;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    dst[to + 4] = r4;
    dst[to + 5] = r5;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p1_4 = p0_4;
    p1_5 = p0_5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    w3 = b3;
    w4 = b4;
    w5 = b5;
    at += 1; to += 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5, p1_0, p1_1, p1_2, p1_3, p1_4, p1_5].map(bits).join(" ") + " " + [w0, w1, w2, w3, w4, w5].join();
}
{ const n = 33; const src = new Int32Array(Math.max(0, n - 1)).map((_, i) => i * 1234567.25 - 5); const dst = new Float64Array(Math.max(0, 6 * n - 1)); for (let k = 0; k < 3; k++) console.log(f2020_1(src, dst, k === 2 ? n >> 1 : n, 1e200, -0, 1/3, k + 0.5, 0), show(src), show(dst)); }
function f2020_2(src, dst, n, c0, c1, c2, q, how) {
  let at = n - 1, to = 3 * (n - 1);
  let p0_0 = q * 1;
  let p0_1 = 0.1;
  let p0_2 = 0;
  let p1_0 = 0;
  let p1_1 = q;
  let p1_2 = 0;
  let p2_0 = -0;
  let p2_1 = q * 2;
  let p2_2 = q * 3;
  let w0 = 0;
  let w1 = 1;
  let w2 = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const b2 = (word >> 16) & 255;
    const r0 = b0 * c0 + w0 * c1 - p0_0 * c1 + p1_0 * q*0.5 - p2_0 * 1/3;
    const r1 = b1 * c0 + w1 * c1 - p0_1 * c1 + p1_1 * q*0.5 - p2_1 * 1/3;
    const r2 = b2 * c0 + w2 * c1 - p0_2 * c1 + p1_2 * q*0.5 - p2_2 * 1/3;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p2_2 = p1_2;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    at -= 1; to -= 3;
  }
  return [p0_0, p0_1, p0_2, p1_0, p1_1, p1_2, p2_0, p2_1, p2_2].map(bits).join(" ") + " " + [w0, w1, w2].join();
}
{ const n = 33; const src = new Uint32Array(Math.max(0, n - 1)).map((_, i) => i === 4 ? Infinity : -i); const dst = new Float32Array(Math.max(0, 3 * n)); for (let k = 0; k < 3; k++) console.log(f2020_2(src, dst, k === 2 ? n >> 1 : n, 1e200, 2, NaN, k + 0.5, 1), show(src), show(dst)); }
function f2021_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 6 * (n - 1), to = 6 * (n - 1);
  let p0_0 = 0;
  let p0_1 = src[0] * 0.5;
  let p0_2 = src[0] * 0.5;
  let p0_3 = q * 4;
  let p0_4 = -0;
  let p0_5 = 0;
  let p1_0 = q * 1;
  let p1_1 = src[0] * 0.5;
  let p1_2 = 0.1;
  let p1_3 = 0;
  let p1_4 = q;
  let p1_5 = q * 6;
  let p2_0 = src[0] * 0.5;
  let p2_1 = 0.1;
  let p2_2 = src[0] * 0.5;
  let p2_3 = -0;
  let p2_4 = q * 5;
  let p2_5 = -0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const r0 = src[at + 0] * c0 + p0_0 * -0.25 - p1_0 * 0 + p2_0 * 1.75;
    const r1 = src[at + 1] * c0 + p0_1 * -0.25 - p1_1 * 0 + p2_1 * 1.75;
    const r2 = src[at + 2] * c0 + p0_2 * -0.25 - p1_2 * 0 + p2_2 * 1.75;
    const r3 = src[at + 3] * c0 + p0_3 * -0.25 - p1_3 * 0 + p2_3 * 1.75;
    const r4 = src[at + 4] * c0 + p0_4 * -0.25 - p1_4 * 0 + p2_4 * 1.75;
    const r5 = src[at + 5] * c0 + p0_5 * -0.25 - p1_5 * 0 + p2_5 * 1.75;
    if (r5 < -1e6) break;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    dst[to + 4] = r4;
    dst[to + 5] = r5;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p2_2 = p1_2;
    p2_3 = p1_3;
    p2_4 = p1_4;
    p2_5 = p1_5;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p1_4 = p0_4;
    p1_5 = p0_5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    at -= 6; to -= 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5, p1_0, p1_1, p1_2, p1_3, p1_4, p1_5, p2_0, p2_1, p2_2, p2_3, p2_4, p2_5].map(bits).join(" ");
}
{ const n = 2; const src = new Int32Array(Math.max(0, 6 * n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Float32Array(Math.max(0, 6 * n)); for (let k = 0; k < 3; k++) console.log(f2021_0(src, dst, k === 2 ? n >> 1 : n, -0.3, -0, 1/3, k + 0.5, 0), show(src), show(dst)); }
function f2021_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = -0;
  let p0_2 = 0.1;
  let p0_3 = q;
  let w0 = 0;
  let w1 = n & 255;
  let w2 = n & 255;
  let w3 = 3;
  for (let i = 0; i < n; i += 2) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const b2 = (word >> 16) & 255;
    const b3 = (word >> 24) & 255;
    const r0 = b0 * c0 + w0 * c1 + p0_0 * c1;
    const r1 = b1 * c0 + w1 * c1 + p0_1 * c1;
    const r2 = b2 * c0 + w2 * c1 + p0_2 * c1;
    const r3 = b3 * c0 + w3 * c1 + p0_3 * c1;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    w0 = b0;
    w1 = b1;
    w2 = b2;
    w3 = b3;
    at += 1; to += 4;
  }
  return [p0_0, p0_1, p0_2, p0_3].map(bits).join(" ") + " " + [w0, w1, w2, w3].join();
}
{ const n = 3; const src = new Uint32Array(Math.max(0, n + 2)).map((_, i) => i * 1234567.25 - 5); const dst = new Int16Array(Math.max(0, 4 * n)); for (let k = 0; k < 3; k++) console.log(f2021_1(src, dst, k === 2 ? n >> 1 : n, 0.5, -0, 1/3, k + 0.5, 2), show(src), show(dst)); }
function f2022_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = -0;
  let p0_2 = src[0] * 0.5;
  let p0_3 = src[0] * 0.5;
  let p1_0 = 0.1;
  let p1_1 = q * 2;
  let p1_2 = q * 3;
  let p1_3 = q * 4;
  for (let i = 0; i < n; i += 2) {
    const r0 = p0_0 * c0 + p0_0 * c1 + p1_0 * -1;
    const r1 = p0_1 * c0 + p0_1 * c1 + p1_1 * -1;
    const r2 = p0_2 * c0 + p0_2 * c1 + p1_2 * -1;
    const r3 = p0_3 * c0 + p0_3 * c1 + p1_3 * -1;
    if (r3 < -1e6) break;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    at += 4; to += 4;
  }
  return [p0_0, p0_1, p0_2, p0_3, p1_0, p1_1, p1_2, p1_3].map(bits).join(" ");
}
{ const n = 1; const src = new Float32Array(Math.max(0, 4 * n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Uint8ClampedArray(Math.max(0, 4 * n + 3)); for (let k = 0; k < 3; k++) console.log(f2022_0(src, dst, k === 2 ? n >> 1 : n, 1e200, 2, 0.125, k + 0.5, 2), show(src), show(dst)); }
function f2022_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 6 * (n - 1), to = 6 * (n - 1);
  let p0_0 = q * 1;
  let p0_1 = q;
  let p0_2 = 0;
  let p0_3 = 0.1;
  let p0_4 = 0.1;
  let p0_5 = 0.1;
  let p1_0 = q * 1;
  let p1_1 = q;
  let p1_2 = src[0] * 0.5;
  let p1_3 = -0;
  let p1_4 = q * 5;
  let p1_5 = 0.1;
  for (let i = n - 1; i >= 0; i -= 1) {
    const r0 = src[at + 0] * 0.5 + p0_0 * -1 - p1_0 * c2;
    const r1 = src[at + 1] * 0.5 + p0_1 * -1 - p1_1 * c2;
    const r2 = src[at + 2] * 0.5 + p0_2 * -1 - p1_2 * c2;
    const r3 = src[at + 3] * 0.5 + p0_3 * -1 - p1_3 * c2;
    const r4 = src[at + 4] * 0.5 + p0_4 * -1 - p1_4 * c2;
    const r5 = src[at + 5] * 0.5 + p0_5 * -1 - p1_5 * c2;
    dst[to + 0] = r0 + p0_0;
    dst[to + 4] = r4 + p0_4;
    dst[to + 3] = r3 + p0_3;
    dst[to + 1] = r1 + p0_1;
    dst[to + 2] = r2 + p0_2;
    dst[to + 5] = r5 + p0_5;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p1_4 = p0_4;
    p1_5 = p0_5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    at -= 6; to -= 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5, p1_0, p1_1, p1_2, p1_3, p1_4, p1_5].map(bits).join(" ");
}
{ const n = 1; const src = new Float32Array(Math.max(0, 6 * n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Int16Array(Math.max(0, 6 * n - 1)); for (let k = 0; k < 3; k++) console.log(f2022_1(src, dst, k === 2 ? n >> 1 : n, 1e200, 2, NaN, k + 0.5, 0), show(src), show(dst)); }
function f2022_2(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = q;
  let p0_1 = -0;
  let p0_2 = src[0] * 0.5;
  let p1_0 = 0;
  let p1_1 = -0;
  let p1_2 = q;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 2] * c0 + p0_0 * 0 + p1_0 * 0;
    const r1 = src[at + 1] * c0 + p0_1 * 0 + p1_1 * 0;
    const r2 = src[at + 0] * c0 + p0_2 * 0 + p1_2 * 0;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    at += 3; to += 3;
  }
  return [p0_0, p0_1, p0_2, p1_0, p1_1, p1_2].map(bits).join(" ");
}
{ const n = 2; const src = new Float64Array(Math.max(0, 3 * n)).map((_, i) => Math.sin(i) * 1e3); const dst = new Float64Array(Math.max(0, 3 * n - 1)); for (let k = 0; k < 3; k++) console.log(f2022_2(src, dst, k === 2 ? n >> 1 : n, 0.11, 0.25, 1/3, k + 0.5, 1), show(src), show(dst)); }
function f2023_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = q;
  let p0_1 = q;
  let p0_2 = q;
  let p0_3 = src[0] * 0.5;
  let p0_4 = 0;
  let p0_5 = q;
  let p1_0 = -0;
  let p1_1 = 0;
  let p1_2 = q * 3;
  let p1_3 = q;
  let p1_4 = src[0] * 0.5;
  let p1_5 = 0;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 5] * c0 + p0_0 * c1 + p1_0 * c2;
    const r1 = src[at + 1] * c0 + p0_1 * c1 + p1_1 * c2;
    const r2 = src[at + 2] * c0 + p0_2 * c1 + p1_2 * c2;
    const r3 = src[at + 3] * c0 + p0_3 * c1 + p1_3 * c2;
    const r4 = src[at + 4] * c0 + p0_4 * c1 + p1_4 * c2;
    const r5 = src[at + 0] * c0 + p0_5 * c1 + p1_5 * c2;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    dst[to + 2] = r2;
    dst[to + 3] = r3;
    dst[to + 4] = r4;
    dst[to + 5] = r5;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p1_2 = p0_2;
    p1_3 = p0_3;
    p1_4 = p0_4;
    p1_5 = p0_5;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    p0_3 = r3;
    p0_4 = r4;
    p0_5 = r5;
    at += 6; to += 6;
  }
  return [p0_0, p0_1, p0_2, p0_3, p0_4, p0_5, p1_0, p1_1, p1_2, p1_3, p1_4, p1_5].map(bits).join(" ");
}
{ const n = 1; const src = new Float32Array(Math.max(0, 6 * n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Float32Array(Math.max(0, 6 * n)); for (let k = 0; k < 3; k++) console.log(f2023_0(src, dst, k === 2 ? n >> 1 : n, 0.11, -0, NaN, k + 0.5, 0), show(src), show(dst)); }
function f2023_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = q * 2;
  let p0_2 = src[0] * 0.5;
  for (let i = 0; i < n; i += 1) {
    const r0 = src[at + 0] * c0 + p0_0 * 1.75;
    const r1 = src[at + 1] * c0 + p0_1 * 1.75;
    const r2 = src[at + 2] * c0 + p0_2 * 1.75;
    p0_0 = r0;
    p0_1 = r1;
    p0_2 = r2;
    at += 3; to += 3;
  }
  return [p0_0, p0_1, p0_2].map(bits).join(" ");
}
{ const n = 0; const src = new Float32Array(Math.max(0, 3 * n)).map((_, i) => Math.sin(i) * 1e3); const dst = new Uint8ClampedArray(Math.max(0, 3 * n)); for (let k = 0; k < 3; k++) console.log(f2023_1(src, dst, k === 2 ? n >> 1 : n, 0.11, -0, 1/3, k + 0.5, 1), show(src), show(dst)); }
function f2024_0(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = -0;
  let p0_1 = q * 2;
  let p1_0 = src[0] * 0.5;
  let p1_1 = -0;
  let p2_0 = q * 1;
  let p2_1 = 0;
  for (let i = 0; i < n; i += 2) {
    const r0 = p0_0 * c0 - p0_0 * c1 + p1_0 * c2 - p2_0 * q*0.5;
    const r1 = p0_1 * c0 - p0_1 * c1 + p1_1 * c2 - p2_1 * q*0.5;
    dst[to + 0] = r0;
    dst[to + 1] = r1;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    at += 2; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1, p2_0, p2_1].map(bits).join(" ");
}
{ const n = 8; const src = new Float64Array(Math.max(0, 2 * n)).map((_, i) => i === 9 ? NaN : i * 0.125); const dst = new Float32Array(Math.max(0, 2 * n - 1)); for (let k = 0; k < 3; k++) console.log(f2024_0(src, dst, k === 2 ? n >> 1 : n, 0.11, 2, 0.125, k + 0.5, 0), show(src), show(dst)); }
function f2024_1(src, dst, n, c0, c1, c2, q, how) {
  let at = 0, to = 0;
  let p0_0 = 0.1;
  let p0_1 = -0;
  let p1_0 = q;
  let p1_1 = q;
  let p2_0 = -0;
  let p2_1 = 0.1;
  let w0 = n & 255;
  let w1 = 0;
  for (let i = 0; i < n; i += 1) {
    const word = src[at];
    const b0 = word & 255;
    const b1 = (word >> 8) & 255;
    const r0 = b0 * Infinity + w0 * c1 + p0_0 * c1 - p1_0 * -0.25 + p2_0 * Infinity;
    const r1 = b1 * Infinity + w1 * c1 + p0_1 * c1 - p1_1 * -0.25 + p2_1 * Infinity + 1;
    dst[to + 0] = p0_0;
    dst[to + 1] = p0_1;
    p2_0 = p1_0;
    p2_1 = p1_1;
    p1_0 = p0_0;
    p1_1 = p0_1;
    p0_0 = r0;
    p0_1 = r1;
    w0 = b0;
    w1 = b1;
    at += 1; to += 2;
  }
  return [p0_0, p0_1, p1_0, p1_1, p2_0, p2_1].map(bits).join(" ") + " " + [w0, w1].join();
}
{ const n = 3; const src = new Uint32Array(Math.max(0, n - 1)).map((_, i) => i % 5 ? i : -i); const dst = new Uint8ClampedArray(Math.max(0, 2 * n)); for (let k = 0; k < 3; k++) console.log(f2024_1(src, dst, k === 2 ? n >> 1 : n, -0.3, 2, NaN, k + 0.5, 1), show(src), show(dst)); }
