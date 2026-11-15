// @ts-nocheck
let ticks = 0;
function tick(v, how) { ticks++; if (how === 1) throw new Error("t" + ticks); if (how === 2 && v.buffer.resizable) v.buffer.resize(v.buffer.byteLength >> 1); if (how === 3 && ticks === 2) try { structuredClone(v.buffer, { transfer: [v.buffer] }); } catch {} }
const B = new DataView(new ArrayBuffer(8));
function show(v) { let t = 17; if (v instanceof Float32Array || v instanceof Float64Array) { for (let i = 0; i < v.length; i++) { const x = v[i]; if (x !== x) t = (Math.imul(t, 31) + 7) | 0; else { B.setFloat64(0, x); t = (Math.imul(t, 31) + B.getInt32(0)) | 0; t = (Math.imul(t, 31) + B.getInt32(4)) | 0; } } } else for (let i = 0; i < v.length; i++) t = (Math.imul(t, 31) + v[i]) | 0; return v.length + ":" + t; }
function f2000_0(v0, n, q, off) {
  let s = 0;
  for (let i = off; i < n - 2; i++) {
    s += (i ^ v0[i]);
  }
  return s;
}
for (const n of [32, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(Math.max(0, n - 1)); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i & 1 ? NaN : -0; for (let k = 0; k < 2; k++) { try { console.log(f2000_0(v0, n, -7, 0)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2000_1(v0: Int16Array, n: number, q: number, off: number) {
  for (let i = 0; i < v0.length; i++) {
    v0[i] = ((q + v0[i + 2]) ^ (v0[i] ^ v0[i]));
  }
  return 0;
}
for (const n of [9, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int16Array(Math.max(0, n - 1)); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2000_1(v0, n, 77, 5)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2000_2(v0, v1, n, q, off) {
  let s = 0;
  for (let i = off; i < n - 1; i++) {
    s |= (v1[i + off] ^ v1[i]);
  }
  return s;
}
for (const n of [1, 1]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint8Array(n); const v1 = new Uint16Array(n); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i * 1234567.5; for (let k = 0; k < 2; k++) { try { console.log(f2000_2(v0, v1, n, -7, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2001_0(v0, v1, v2, n, q, off) {
  let s = 0;
  for (let i = 1; i < n; i++) {
    s ^= (3 + v1[i + 1]);
  }
  return s;
}
for (const n of [5, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(n); const v1 = new Int32Array(n); const v2 = new Uint8Array(n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i === 6 ? -Infinity : i * 0.25; for (let k = 0; k < 2; k++) { try { console.log(f2001_0(v0, v1, v2, n, 77, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2001_1(v0: Int32Array, v1: Int32Array, n: number, q: number, off: number) {
  let s = -1;
  for (let i = 0; i <= n - 2; i += 2) {
    v0[i] = v1[i];
    s += (7 + v0[i]);
  }
  return s;
}
for (const n of [57, 57]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(n); const v1 = v0; for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i & 1 ? NaN : -0; for (let k = 0; k < 2; k++) { try { console.log(f2001_1(v0, v1, n, -7, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2001_2(v0: Float32Array, v1: Float32Array, n: number, q: number, off: number) {
  for (let i = 0; i < n - 1; i++) {
    v0[i + 2] = ((-0 - v0[i + off]) + (v0[i + 1] - v1[i + 1]));
  }
  return 0;
}
for (const n of [5, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(buffer, 64, n); const v1 = new Float32Array(buffer, 64, n); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i % 5 ? i * 0.1 : -0; for (let k = 0; k < 2; k++) { try { console.log(f2001_2(v0, v1, n, 1000003, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2001_3(v0: Int32Array, n: number, q: number, off: number) {
  for (let i = 0; i < n - 1; i++) {
    v0[i] += (q >>> 24);
  }
  return 0;
}
for (const n of [257, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(buffer, 16, n * 2 + 8); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i * 37 - 11; for (let k = 0; k < 2; k++) { try { console.log(f2001_3(v0, n, 1000003, 1)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2002_0(v0: Int16Array, v1: Int16Array, n: number, q: number, off: number) {
  for (let i = 0; i < n; i++) {
    v1[i] = v1[i + 2];
  }
  return 0;
}
for (const n of [17, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int16Array(buffer, 24, n); const v1 = new Int16Array(buffer, 32, n); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = 2 ** 53 - i; for (let k = 0; k < 2; k++) { try { console.log(f2002_0(v0, v1, n, 1000003, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2002_1(v0: Uint32Array, v1: Int32Array, n: number, q: number, off: number) {
  for (let i = 1; i < n - 1; i++) {
    v0[i + 2] = ((v1[i] + v0[i]) ^ v1[i]);
  }
  return 0;
}
for (const n of [64, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint32Array(n * 2 + 8); const v1 = new Int32Array(n * 2 + 8); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i * 37 - 11; for (let k = 0; k < 2; k++) { try { console.log(f2002_1(v0, v1, n, 3, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2002_2(v0, v1, n, q, off) {
  let j = 0;
  for (let i = 0; i < n - 2; i++) {
    v0[j] = ((v0[i + off] * v1[j]) / (v0[i] + v1[j]));
    j++;
  }
  return 0;
}
for (const n of [257, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(buffer, 40, n + 3); const v1 = new Float32Array(buffer, 0, n + 3); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = (i % 7) - 3; for (let k = 0; k < 2; k++) { try { console.log(f2002_2(v0, v1, n, 2.5, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2002_3(v0: Float64Array, n: number, q: number, off: number) {
  for (let i = 0; i < n - 1; i++) {
    v0[i] = ((v0[i + off] * v0[i]) / 0.5);
  }
  return 0;
}
for (const n of [49, 49]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(n); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = 2 ** 53 - i; for (let k = 0; k < 2; k++) { try { console.log(f2002_3(v0, n, 3, 2)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2003_0(v0: Float32Array, v1: Float32Array, v2: Float32Array, n: number, q: number, off: number) {
  let s = q | 0;
  for (let i = 1; i < n - 2; i++) {
    v0[i] *= ((-0 * v2[i + 2]) + (v1[i + 1] + v0[i]));
    s += v0[i + 1];
  }
  return s;
}
for (const n of [31, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(n); const v1 = new Float32Array(n); const v2 = new Float32Array(n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2003_0(v0, v1, v2, n, 3, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2003_1(v0, n, q, off) {
  let j = 0;
  for (let i = 1; i < n; i++) {
    v0[i] = -0;
    v0[i + off] = q;
    j++;
  }
  return 0;
}
for (const n of [7, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(n); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i === 6 ? -Infinity : i * 0.25; for (let k = 0; k < 2; k++) { try { console.log(f2003_1(v0, n, 2.5, 5)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2004_0(v0: Int32Array, v1: Uint32Array, v2: Int32Array, n: number, q: number, off: number) {
  let s = -1;
  let j = n - 1;
  for (let i = 0; i < n - 1; i++) {
    v0[i] = v0[i];
    v2[i + 2] += (v1[j] ^ (v0[i + 2] + v1[i + 1]));
    s &= v2[j + 1];
    j--;
  }
  return s;
}
for (const n of [7, 7]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(buffer, 0, Math.max(0, n - 1)); const v1 = new Uint32Array(buffer, 0, Math.max(0, n - 1)); const v2 = new Int32Array(buffer, 0, Math.max(0, n - 1)); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = (i % 7) - 3; for (let k = 0; k < 2; k++) { try { console.log(f2004_0(v0, v1, v2, n, 77, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2004_1(v0, v1, v2, n, q, off) {
  for (let i = 0; i < n; i++) {
    v0[i + 1] = q;
  }
  return 0;
}
for (const n of [100, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(buffer, 0, n); const v1 = new Float64Array(buffer, 16, n); const v2 = new Float64Array(buffer, 24, n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i === 5 ? NaN : i; for (let k = 0; k < 2; k++) { try { console.log(f2004_1(v0, v1, v2, n, 2.5, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2004_2(v0, v1, v2, n, q, off) {
  for (let i = 0; i < v0.length; i++) {
    v1[i + 1] += 3;
  }
  return 0;
}
for (const n of [3, 3]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(n + 3); const v1 = v0; const v2 = v0; for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = 2 ** 53 - i; for (let k = 0; k < 2; k++) { try { console.log(f2004_2(v0, v1, v2, n, 3, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2004_3(v0: Int32Array, n: number, q: number, off: number) {
  let s = 0;
  for (let i = 1; i < n - 1; i++) {
    s &= v0[i + 1];
  }
  return s;
}
for (const n of [257, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(n); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = 2 ** 53 - i; for (let k = 0; k < 2; k++) { try { console.log(f2004_3(v0, n, 1000003, 0)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2005_0(v0, n, q, off) {
  let s = q | 0;
  for (let i = 0; i < n; i++) {
    v0[i + 1] = ((v0[i] >>> 1) + (v0[i + 1] - v0[i + off]));
    v0[i] = v0[i];
    s = (s + (v0[i] >> 8)) | 0;
  }
  return s;
}
for (const n of [7, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint32Array(n); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i * 37 - 11; for (let k = 0; k < 2; k++) { try { console.log(f2005_0(v0, n, 3, 0)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2005_1(v0, v1, n, q, off) {
  for (let i = 0; i < n - 2; i++) {
    v1[i + 2] = ((v0[i + 1] | v1[i + off]) + v0[i]);
  }
  return 0;
}
for (const n of [16, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32), { maxByteLength: 8 * (n * 2 + 32) }); const v0 = new Int8Array(buffer, 0, n + 3); const v1 = new Int8Array(buffer, 0, n + 3); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i * 1234567.5; for (let k = 0; k < 2; k++) { try { console.log(f2005_1(v0, v1, n, 3, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2005_2(v0, n, q, off) {
  let j = off;
  for (let i = 1; i < n - 1; i++) {
    v0[i + 2] = (v0[i + 2] * (v0[j + off] * v0[i]));
    j++;
  }
  return 0;
}
for (const n of [13, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32), { maxByteLength: 8 * (n * 2 + 32) }); const v0 = new Float32Array(buffer, 0, n + 3); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = 2 ** 53 - i; for (let k = 0; k < 2; k++) { try { console.log(f2005_2(v0, n, 3, 2)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2006_0(v0: Int8Array, n: number, q: number, off: number) {
  let s = q | 0;
  for (let i = 0; i < n; i++) {
    s = (s - (v0[i + 1] + 255)) | 0;
  }
  return s;
}
for (const n of [8, 8]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int8Array(n); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i === 5 ? NaN : i; for (let k = 0; k < 2; k++) { try { console.log(f2006_0(v0, n, 77, 0)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2006_1(v0, n, q, off) {
  let s = q | 0;
  for (let i = 1; i < n; i += 2) {
    v0[i] = v0[i + 2];
    s += (q + v0[i]);
  }
  return s;
}
for (const n of [61, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(buffer, 0, Math.max(0, n - 1)); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i & 1 ? NaN : -0; for (let k = 0; k < 2; k++) { try { console.log(f2006_1(v0, n, 3, 0)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2006_2(v0, v1, n, q, off) {
  for (let i = 0; i < n - 2; i++) {
    v0[i] = (v1[i + 1] >> 31);
  }
  return 0;
}
for (const n of [47, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32), { maxByteLength: 8 * (n * 2 + 32) }); const v0 = new Uint32Array(buffer, 0, n); const v1 = new Uint32Array(buffer, 0, n); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i % 5 ? i * 0.1 : -0; for (let k = 0; k < 2; k++) { try { console.log(f2006_2(v0, v1, n, 77, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2006_3(v0: Float64Array, v1: Float32Array, n: number, q: number, off: number) {
  let s = q | 0;
  for (let i = 0; i < n; i++) {
    v0[i] = (q / (q * v1[i + 2]));
    s += (0.5 * v1[i]);
  }
  return s;
}
for (const n of [9, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(n * 2 + 8); const v1 = new Float32Array(n * 2 + 8); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i * 1234567.5; for (let k = 0; k < 2; k++) { try { console.log(f2006_3(v0, v1, n, 1000003, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2007_0(v0, v1, v2, n, q, off) {
  for (let i = 0; i < n - 1; i++) {
    v0[i + off] = v2[i + off];
  }
  return 0;
}
for (const n of [53, 53]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(buffer, 0, Math.max(0, n - 1)); const v1 = new Float32Array(buffer, 0, Math.max(0, n - 1)); const v2 = new Float32Array(buffer, 0, Math.max(0, n - 1)); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i === 5 ? NaN : i; for (let k = 0; k < 2; k++) { try { console.log(f2007_0(v0, v1, v2, n, 3, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2007_1(v0, v1, v2, n, q, off) {
  let s = 0;
  for (let i = off; i <= n - 1; i++) {
    s ^= (q << 1);
  }
  return s;
}
for (const n of [33, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(buffer, 0, n * 2 + 8); const v1 = new Int32Array(buffer, 0, n * 2 + 8); const v2 = new Int32Array(buffer, 0, n * 2 + 8); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i * 1234567.5; for (let k = 0; k < 2; k++) { try { console.log(f2007_1(v0, v1, v2, n, 77, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2008_0(v0, v1, n, q, off) {
  let s = -1;
  for (let i = off; i < v0.length; i++) {
    v1[i] = (v0[i] | v0[i]);
    s ^= v1[i + 2];
    if (i === 41) tick(v0, 2);
  }
  return s;
}
for (const n of [64, 64]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(buffer, 0, n + 3); const v1 = new Uint32Array(buffer, 40, n + 3); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i * 37 - 11; for (let k = 0; k < 2; k++) { try { console.log(f2008_0(v0, v1, n, 1000003, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2008_1(v0, v1, v2, n, q, off) {
  for (let i = 0; i <= n - 1; i++) {
    v1[i + 2] = ((v1[i] << 1) + (v0[i] >>> 8));
  }
  return 0;
}
for (const n of [31, 31]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int8Array(buffer, 8, n + 3); const v1 = new Uint8ClampedArray(buffer, 24, n + 3); const v2 = new Uint8Array(buffer, 16, n + 3); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i === 5 ? NaN : i; for (let k = 0; k < 2; k++) { try { console.log(f2008_1(v0, v1, v2, n, -7, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2009_0(v0, v1, v2, n, q, off) {
  let s = 0;
  for (let i = 0; i < n - 2; i += 2) {
    v2[i] += (q * -0);
    v2[i] = v0[i + off];
    s += (v0[i + 2] / v2[i]);
  }
  return s;
}
for (const n of [1, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(n + 3); const v1 = v0; const v2 = v0; for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2009_0(v0, v1, v2, n, -7, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2009_1(v0: Float32Array, v1: Float32Array, v2: Float32Array, n: number, q: number, off: number) {
  for (let i = 1; i < v0.length; i++) {
    v2[i + 1] *= 0.5;
    v0[i + off] = v2[i];
  }
  return 0;
}
for (const n of [9, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(buffer, 8, Math.max(0, n - 1)); const v1 = new Float32Array(buffer, 8, Math.max(0, n - 1)); const v2 = new Float32Array(buffer, 32, Math.max(0, n - 1)); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2009_1(v0, v1, v2, n, 1000003, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2009_2(v0: Uint8ClampedArray, v1: Int8Array, v2: Uint8Array, n: number, q: number, off: number) {
  let s = -1;
  for (let i = off; i < n - 2; i++) {
    v0[i + off] += ((q ^ v2[i]) | (3 | v0[i]));
    s = (s - (3 + 7)) | 0;
  }
  return s;
}
for (const n of [15, 15]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint8ClampedArray(Math.max(0, n - 1)); const v1 = new Int8Array(Math.max(0, n - 1)); const v2 = new Uint8Array(Math.max(0, n - 1)); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i === 6 ? -Infinity : i * 0.25; for (let k = 0; k < 2; k++) { try { console.log(f2009_2(v0, v1, v2, n, 1000003, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2010_0(v0: Float64Array, v1: Float32Array, n: number, q: number, off: number) {
  let j = n - 1;
  for (let i = 0; i < n - 2; i++) {
    v0[i] *= (v0[i + 2] * (v0[j] / v0[i]));
    j++;
  }
  return 0;
}
for (const n of [257, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(buffer, 16, n + 3); const v1 = new Float32Array(buffer, 32, n + 3); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i === 6 ? -Infinity : i * 0.25; for (let k = 0; k < 2; k++) { try { console.log(f2010_0(v0, v1, n, 3, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2010_1(v0: Float32Array, v1: Float32Array, v2: Float32Array, n: number, q: number, off: number) {
  let s = -1;
  for (let i = 0; i < n; i++) {
    s += 0.5;
  }
  return s;
}
for (const n of [30, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32), { maxByteLength: 8 * (n * 2 + 32) }); const v0 = new Float32Array(buffer, 0, n); const v1 = new Float32Array(buffer, 0, n); const v2 = new Float32Array(buffer, 0, n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2010_1(v0, v1, v2, n, -7, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2011_0(v0: Uint8ClampedArray, n: number, q: number, off: number) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    s ^= v0[i + off];
  }
  return s;
}
for (const n of [31, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint8ClampedArray(buffer, 24, n); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i === 6 ? -Infinity : i * 0.25; for (let k = 0; k < 2; k++) { try { console.log(f2011_0(v0, n, 1000003, 1)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2011_1(v0: Float32Array, v1: Float32Array, v2: Float32Array, n: number, q: number, off: number) {
  for (let i = 1; i <= n - 1; i++) {
    v2[i] *= (v2[i] / v2[i]);
    v1[i + 2] = (v1[i + off] + (v2[i + 2] - v1[i + off]));
  }
  return 0;
}
for (const n of [6, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(buffer, 0, Math.max(0, n - 1)); const v1 = new Float32Array(buffer, 0, Math.max(0, n - 1)); const v2 = new Float32Array(buffer, 0, Math.max(0, n - 1)); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i & 1 ? NaN : -0; for (let k = 0; k < 2; k++) { try { console.log(f2011_1(v0, v1, v2, n, 2.5, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2011_2(v0: Int8Array, v1: Uint8Array, v2: Uint8ClampedArray, n: number, q: number, off: number) {
  let s = q | 0;
  for (let i = off; i <= n - 1; i++) {
    s ^= q;
  }
  return s;
}
for (const n of [257, 257]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int8Array(buffer, 32, n + 3); const v1 = new Uint8Array(buffer, 64, n + 3); const v2 = new Uint8ClampedArray(buffer, 8, n + 3); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = (i % 7) - 3; for (let k = 0; k < 2; k++) { try { console.log(f2011_2(v0, v1, v2, n, -7, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2011_3(v0, v1, v2, n, q, off) {
  let s = 0;
  for (let i = 1; i < v0.length; i += 2) {
    s += q;
  }
  return s;
}
for (const n of [8, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(n + 3); const v1 = new Float32Array(n + 3); const v2 = new Float32Array(n + 3); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = (i % 7) - 3; for (let k = 0; k < 2; k++) { try { console.log(f2011_3(v0, v1, v2, n, -7, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2012_0(v0: Uint8Array, v1: Uint8Array, v2: Uint8Array, n: number, q: number, off: number) {
  for (let i = 0; i < n - 1; i++) {
    v2[i] += (7 + (v1[i] | v0[i + 2]));
  }
  return 0;
}
for (const n of [1, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint8Array(Math.max(0, n - 1)); const v1 = new Uint8Array(Math.max(0, n - 1)); const v2 = new Uint8Array(Math.max(0, n - 1)); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i === 6 ? -Infinity : i * 0.25; for (let k = 0; k < 2; k++) { try { console.log(f2012_0(v0, v1, v2, n, 1000003, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2012_1(v0, v1, n, q, off) {
  let s = 0;
  let j = off;
  for (let i = 0; i < n - 1; i++) {
    v0[i + off] = (q - v1[i + 1]);
    s += (v1[i] + v1[i + off]);
    j++;
  }
  return s;
}
for (const n of [1, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(n * 2 + 8); const v1 = new Float64Array(n * 2 + 8); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i & 1 ? NaN : -0; for (let k = 0; k < 2; k++) { try { console.log(f2012_1(v0, v1, n, 3, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2013_0(v0, v1, v2, n, q, off) {
  let s = q | 0;
  for (let i = 0; i < n; i++) {
    s += 0.5;
  }
  return s;
}
for (const n of [49, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(n); const v1 = new Float64Array(n); const v2 = new Float64Array(n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2013_0(v0, v1, v2, n, -7, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2013_1(v0, v1, v2, n, q, off) {
  for (let i = 0; i < n - 2; i += 2) {
    v0[i] = (v2[i + 2] & (v1[i] | v1[i + 1]));
  }
  return 0;
}
for (const n of [32, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint16Array(n + 3); const v1 = new Uint16Array(n + 3); const v2 = new Int16Array(n + 3); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i * 37 - 11; for (let k = 0; k < 2; k++) { try { console.log(f2013_1(v0, v1, v2, n, -7, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2013_2(v0, v1, v2, n, q, off) {
  let s = 0;
  for (let i = 0; i <= n - 2; i++) {
    v2[i] = (v0[i + 1] >>> 3);
    v0[i + 2] += q;
    s ^= v0[i + 2];
  }
  return s;
}
for (const n of [20, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint8ClampedArray(n); const v1 = new Uint8Array(n); const v2 = new Int8Array(n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2013_2(v0, v1, v2, n, 3, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2014_0(v0: Uint8ClampedArray, v1: Uint8Array, n: number, q: number, off: number) {
  let s = -1;
  for (let i = off; i < n - 1; i++) {
    v0[i + off] = v1[i + 1];
    s ^= v0[i];
  }
  return s;
}
for (const n of [100, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint8ClampedArray(n); const v1 = new Uint8Array(n); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i === 5 ? NaN : i; for (let k = 0; k < 2; k++) { try { console.log(f2014_0(v0, v1, n, 77, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2014_1(v0: Int8Array, n: number, q: number, off: number) {
  for (let i = 0; i < v0.length; i++) {
    v0[i] = ((v0[i] & v0[i + 1]) + v0[i + off]);
    if (i === 50) break;
  }
  return 0;
}
for (const n of [0, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int8Array(Math.max(0, n - 1)); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i === 6 ? -Infinity : i * 0.25; for (let k = 0; k < 2; k++) { try { console.log(f2014_1(v0, n, 77, 1)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2014_2(v0: Int32Array, v1: Int32Array, n: number, q: number, off: number) {
  let s = q | 0;
  for (let i = 0; i < n; i += 2) {
    s &= v0[i];
    if (i === 50) break;
  }
  return s;
}
for (const n of [33, 33]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32), { maxByteLength: 8 * (n * 2 + 32) }); const v0 = new Int32Array(buffer, 0, Math.max(0, n - 1)); const v1 = new Int32Array(buffer, 0, Math.max(0, n - 1)); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2014_2(v0, v1, n, 3, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2015_0(v0, v1, v2, n, q, off) {
  let s = 0;
  let j = n - 1;
  for (let i = off; i < n - 2; i++) {
    v0[j] = v2[i];
    s |= (v1[j + off] >> 1);
    j++;
  }
  return s;
}
for (const n of [11, 11]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint8Array(n); const v1 = new Int8Array(n); const v2 = new Uint8ClampedArray(n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i === 6 ? -Infinity : i * 0.25; for (let k = 0; k < 2; k++) { try { console.log(f2015_0(v0, v1, v2, n, -7, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2015_1(v0: Uint32Array, v1: Uint32Array, v2: Int32Array, n: number, q: number, off: number) {
  for (let i = 1; i < n - 2; i++) {
    v1[i] = v0[i];
    v0[i] = v2[i + off];
  }
  return 0;
}
for (const n of [1, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint32Array(n + 3); const v1 = v0; const v2 = new Int32Array(n + 3); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = (i % 7) - 3; for (let k = 0; k < 2; k++) { try { console.log(f2015_1(v0, v1, v2, n, 77, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2015_2(v0, n, q, off) {
  let j = n - 1;
  for (let i = 0; i < n - 2; i++) {
    v0[j] = (v0[i] * (v0[i] * v0[i + 2]));
    j++;
  }
  return 0;
}
for (const n of [52, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(n * 2 + 8); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = 2 ** 53 - i; for (let k = 0; k < 2; k++) { try { console.log(f2015_2(v0, n, 3, 2)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2015_3(v0, n, q, off) {
  let j = off;
  for (let i = 1; i < n; i += 2) {
    v0[j + 2] = q;
    j++;
  }
  return 0;
}
for (const n of [31, 31]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(Math.max(0, n - 1)); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2015_3(v0, n, 1000003, 2)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2016_0(v0, n, q, off) {
  for (let i = 0; i < v0.length; i++) {
    v0[i] = (v0[i + off] + v0[i + 2]);
  }
  return 0;
}
for (const n of [31, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(n); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2016_0(v0, n, -7, 5)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2016_1(v0, n, q, off) {
  let s = q | 0;
  let j = n - 1;
  for (let i = 0; i < v0.length; i += 2) {
    s ^= v0[j];
    j--;
  }
  return s;
}
for (const n of [7, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint16Array(buffer, 32, n); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i === 5 ? NaN : i; for (let k = 0; k < 2; k++) { try { console.log(f2016_1(v0, n, -7, 2)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2016_2(v0: Int32Array, n: number, q: number, off: number) {
  for (let i = 0; i < n; i++) {
    v0[i] = v0[i + off];
  }
  return 0;
}
for (const n of [3, 3]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(buffer, 0, Math.max(0, n - 1)); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i * 1234567.5; for (let k = 0; k < 2; k++) { try { console.log(f2016_2(v0, n, 3, 2)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2016_3(v0, v1, v2, n, q, off) {
  for (let i = 0; i < n - 2; i++) {
    v1[i + off] *= v1[i + off];
  }
  return 0;
}
for (const n of [0, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32), { maxByteLength: 8 * (n * 2 + 32) }); const v0 = new Float32Array(buffer, 0, n); const v1 = new Float32Array(buffer, 0, n); const v2 = new Float32Array(buffer, 0, n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i === 5 ? NaN : i; for (let k = 0; k < 2; k++) { try { console.log(f2016_3(v0, v1, v2, n, 2.5, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2017_0(v0, v1, v2, n, q, off) {
  let s = -1;
  for (let i = 0; i < n; i++) {
    s = (s - q) | 0;
  }
  return s;
}
for (const n of [3, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint16Array(n * 2 + 8); const v1 = new Int16Array(n * 2 + 8); const v2 = new Int16Array(n * 2 + 8); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i % 5 ? i * 0.1 : -0; for (let k = 0; k < 2; k++) { try { console.log(f2017_0(v0, v1, v2, n, 3, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2017_1(v0, v1, v2, n, q, off) {
  let s = 0;
  for (let i = 0; i < n - 2; i++) {
    s += (v1[i] * v1[i + off]);
  }
  return s;
}
for (const n of [62, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(Math.max(0, n - 1)); const v1 = new Float64Array(Math.max(0, n - 1)); const v2 = new Float32Array(Math.max(0, n - 1)); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i & 1 ? NaN : -0; for (let k = 0; k < 2; k++) { try { console.log(f2017_1(v0, v1, v2, n, 1000003, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2018_0(v0, n, q, off) {
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    s = (s + v0[i + off]) | 0;
  }
  return s;
}
for (const n of [31, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint32Array(buffer, 32, n * 2 + 8); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = (i % 7) - 3; for (let k = 0; k < 2; k++) { try { console.log(f2018_0(v0, n, -7, 5)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2018_1(v0: Uint16Array, n: number, q: number, off: number) {
  for (let i = 1; i < v0.length; i++) {
    v0[i] += v0[i];
    if (i === 41) tick(v0, 0);
  }
  return 0;
}
for (const n of [9, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint16Array(n); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = (i % 7) - 3; for (let k = 0; k < 2; k++) { try { console.log(f2018_1(v0, n, 1000003, 0)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2018_2(v0, v1, n, q, off) {
  for (let i = off; i < n - 2; i++) {
    v0[i + 2] *= ((v0[i + off] * v0[i + 1]) + v0[i + 1]);
  }
  return 0;
}
for (const n of [16, 16]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(buffer, 16, n + 3); const v1 = new Float32Array(buffer, 24, n + 3); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2018_2(v0, v1, n, 2.5, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2018_3(v0: Uint32Array, n: number, q: number, off: number) {
  let s = -1;
  for (let i = 0; i < v0.length; i++) {
    s ^= (v0[i] ^ q);
  }
  return s;
}
for (const n of [9, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint32Array(buffer, 0, n * 2 + 8); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = 2 ** 53 - i; for (let k = 0; k < 2; k++) { try { console.log(f2018_3(v0, n, -7, 1)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2019_0(v0, n, q, off) {
  for (let i = off; i < v0.length; i++) {
    v0[i] *= ((v0[i] + v0[i]) * (v0[i] + v0[i]));
    v0[i] *= v0[i];
  }
  return 0;
}
for (const n of [31, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(buffer, 40, n + 3); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i * 1234567.5; for (let k = 0; k < 2; k++) { try { console.log(f2019_0(v0, n, 1000003, 0)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2019_1(v0: Int32Array, v1: Uint32Array, n: number, q: number, off: number) {
  for (let i = 0; i < n; i++) {
    v1[i + off] = v1[i];
    v0[i + 1] += v1[i];
  }
  return 0;
}
for (const n of [16, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(buffer, 0, Math.max(0, n - 1)); const v1 = new Uint32Array(buffer, 0, Math.max(0, n - 1)); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2019_1(v0, v1, n, 3, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2020_0(v0, v1, n, q, off) {
  for (let i = 0; i < n; i++) {
    v1[i] *= v1[i + 2];
    v1[i] = (q + v0[i + 2]);
  }
  return 0;
}
for (const n of [56, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(n * 2 + 8); const v1 = new Float64Array(n * 2 + 8); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2020_0(v0, v1, n, -7, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2020_1(v0, v1, v2, n, q, off) {
  for (let i = 1; i < n - 1; i++) {
    v1[i + off] = ((v2[i] >> 1) - (q | v0[i + 1]));
    v1[i + off] = ((255 ^ v2[i + 1]) | v1[i + off]);
  }
  return 0;
}
for (const n of [5, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(Math.max(0, n - 1)); const v1 = new Int32Array(Math.max(0, n - 1)); const v2 = new Uint32Array(Math.max(0, n - 1)); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i % 5 ? i * 0.1 : -0; for (let k = 0; k < 2; k++) { try { console.log(f2020_1(v0, v1, v2, n, 1000003, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2020_2(v0: Uint8Array, v1: Uint8ClampedArray, v2: Uint8Array, n: number, q: number, off: number) {
  let j = n - 1;
  for (let i = 0; i < n - 1; i++) {
    v0[j + 2] += (q | v0[i + off]);
    j++;
  }
  return 0;
}
for (const n of [17, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32), { maxByteLength: 8 * (n * 2 + 32) }); const v0 = new Uint8Array(buffer, 0, n * 2 + 8); const v1 = new Uint8ClampedArray(buffer, 0, n * 2 + 8); const v2 = new Uint8Array(buffer, 0, n * 2 + 8); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2020_2(v0, v1, v2, n, -7, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2020_3(v0: Uint32Array, n: number, q: number, off: number) {
  for (let i = 1; i < n - 1; i++) {
    v0[i + 2] = ((v0[i + 1] & v0[i]) | v0[i + off]);
  }
  return 0;
}
for (const n of [28, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint32Array(buffer, 32, n * 2 + 8); for (const v of [v0]) for (let i = 0; i < v.length; i++) v[i] = i === 5 ? NaN : i; for (let k = 0; k < 2; k++) { try { console.log(f2020_3(v0, n, 3, 1)); } catch (e) { console.log(e.message); } console.log(show(v0)); } }
function f2021_0(v0: Float32Array, v1: Float32Array, n: number, q: number, off: number) {
  for (let i = 0; i < n; i++) {
    v0[i + 2] *= ((3 * v1[i + 1]) + (v1[i + 1] / v0[i + 1]));
  }
  return 0;
}
for (const n of [257, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(buffer, 0, n); const v1 = new Float32Array(buffer, 0, n); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = 2 ** 53 - i; for (let k = 0; k < 2; k++) { try { console.log(f2021_0(v0, v1, n, -7, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2021_1(v0: Float32Array, v1: Float32Array, v2: Float32Array, n: number, q: number, off: number) {
  let s = -1;
  for (let i = 1; i < n; i++) {
    v2[i + 1] = v2[i + 1];
    s += q;
  }
  return s;
}
for (const n of [100, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float32Array(buffer, 0, n); const v1 = new Float32Array(buffer, 0, n); const v2 = new Float32Array(buffer, 0, n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i & 1 ? NaN : -0; for (let k = 0; k < 2; k++) { try { console.log(f2021_1(v0, v1, v2, n, 3, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2021_2(v0: Int8Array, v1: Uint8Array, n: number, q: number, off: number) {
  let s = q | 0;
  for (let i = 0; i <= n - 2; i += 2) {
    v1[i] ^= 7;
    s = (s + (v1[i] ^ v1[i])) | 0;
  }
  return s;
}
for (const n of [9, 9]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int8Array(buffer, 0, n * 2 + 8); const v1 = new Uint8Array(buffer, 0, n * 2 + 8); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i % 5 ? i * 0.1 : -0; for (let k = 0; k < 2; k++) { try { console.log(f2021_2(v0, v1, n, 1000003, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2022_0(v0, v1, v2, n, q, off) {
  for (let i = 0; i < n - 1; i += 2) {
    v0[i] = ((v0[i + off] | v2[i]) + (q ^ v1[i]));
    if (i === 41) tick(v0, 1);
  }
  return 0;
}
for (const n of [7, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint32Array(n); const v1 = new Uint32Array(n); const v2 = new Int32Array(n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i % 5 ? i * 0.1 : -0; for (let k = 0; k < 2; k++) { try { console.log(f2022_0(v0, v1, v2, n, 1000003, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2022_1(v0: Uint8Array, v1: Uint8ClampedArray, n: number, q: number, off: number) {
  let s = 0;
  for (let i = 0; i <= n; i++) {
    v0[i + 1] = v1[i];
    s &= (v1[i] + v0[i + 1]);
  }
  return s;
}
for (const n of [100, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32), { maxByteLength: 8 * (n * 2 + 32) }); const v0 = new Uint8Array(buffer, 0, Math.max(0, n - 1)); const v1 = new Uint8ClampedArray(buffer, 0, Math.max(0, n - 1)); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i * 1234567.5; for (let k = 0; k < 2; k++) { try { console.log(f2022_1(v0, v1, n, 77, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2022_2(v0: Int8Array, v1: Int8Array, n: number, q: number, off: number) {
  for (let i = 0; i < n; i++) {
    v1[i] = ((v1[i + 1] + v1[i]) ^ (v0[i] & v1[i]));
    if (i === 41) tick(v0, 1);
  }
  return 0;
}
for (const n of [64, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int8Array(n * 2 + 8); const v1 = v0; for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = i * 1234567.5; for (let k = 0; k < 2; k++) { try { console.log(f2022_2(v0, v1, n, 1000003, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2022_3(v0: Uint16Array, v1: Uint8Array, v2: Uint8Array, n: number, q: number, off: number) {
  let s = q | 0;
  for (let i = 0; i < v0.length; i++) {
    s = (s - v0[i]) | 0;
  }
  return s;
}
for (const n of [32, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint16Array(buffer, 32, n); const v1 = new Uint8Array(buffer, 32, n); const v2 = new Uint8Array(buffer, 0, n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = 2 ** 53 - i; for (let k = 0; k < 2; k++) { try { console.log(f2022_3(v0, v1, v2, n, 3, 2)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2023_0(v0, v1, v2, n, q, off) {
  for (let i = off; i < n - 2; i++) {
    v2[i] = (v2[i] - (v1[i + 2] * v0[i + 2]));
  }
  return 0;
}
for (const n of [32, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32), { maxByteLength: 8 * (n * 2 + 32) }); const v0 = new Float64Array(buffer, 0, n); const v1 = new Float32Array(buffer, 0, n); const v2 = new Float32Array(buffer, 0, n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i * 1234567.5; for (let k = 0; k < 2; k++) { try { console.log(f2023_0(v0, v1, v2, n, 3, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2023_1(v0, v1, v2, n, q, off) {
  for (let i = 0; i < n - 2; i++) {
    v0[i + 2] = v1[i];
  }
  return 0;
}
for (const n of [26, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int32Array(Math.max(0, n - 1)); const v1 = new Int32Array(Math.max(0, n - 1)); const v2 = new Uint32Array(Math.max(0, n - 1)); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i & 1 ? NaN : -0; for (let k = 0; k < 2; k++) { try { console.log(f2023_1(v0, v1, v2, n, 1000003, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
function f2023_2(v0: Int16Array, v1: Int16Array, n: number, q: number, off: number) {
  for (let i = 0; i < v0.length; i += 2) {
    v1[i + off] = (v1[i] + 7);
    v1[i] += v0[i];
  }
  return 0;
}
for (const n of [0, 0]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Int16Array(n); const v1 = v0; for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = (i % 7) - 3; for (let k = 0; k < 2; k++) { try { console.log(f2023_2(v0, v1, n, -7, 0)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2024_0(v0: Int32Array, v1: Uint32Array, n: number, q: number, off: number) {
  for (let i = off; i < n; i++) {
    v1[i + off] ^= ((v1[i + 1] + v0[i]) | (v1[i] ^ v1[i]));
  }
  return 0;
}
for (const n of [52, 40]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32), { maxByteLength: 8 * (n * 2 + 32) }); const v0 = new Int32Array(buffer, 0, n); const v1 = new Uint32Array(buffer, 0, n); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2024_0(v0, v1, n, 1000003, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2024_1(v0: Float64Array, v1: Float32Array, n: number, q: number, off: number) {
  for (let i = 0; i < v0.length; i++) {
    v0[i + off] *= v0[i];
    v0[i + 2] *= (q / v1[i]);
  }
  return 0;
}
for (const n of [16, 5]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Float64Array(Math.max(0, n - 1)); const v1 = new Float32Array(Math.max(0, n - 1)); for (const v of [v0, v1]) for (let i = 0; i < v.length; i++) v[i] = Math.sin(i) * 1e10; for (let k = 0; k < 2; k++) { try { console.log(f2024_1(v0, v1, n, 2.5, 5)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1)); } }
function f2024_2(v0, v1, v2, n, q, off) {
  let s = q | 0;
  for (let i = 0; i <= n - 2; i++) {
    s ^= v2[i + off];
  }
  return s;
}
for (const n of [8, 8]) { const buffer = new ArrayBuffer(8 * (n * 2 + 32)); const v0 = new Uint8ClampedArray(n); const v1 = v0; const v2 = new Uint8Array(n); for (const v of [v0, v1, v2]) for (let i = 0; i < v.length; i++) v[i] = i & 1 ? NaN : -0; for (let k = 0; k < 2; k++) { try { console.log(f2024_2(v0, v1, v2, n, 3, 1)); } catch (e) { console.log(e.message); } console.log(show(v0), show(v1), show(v2)); } }
