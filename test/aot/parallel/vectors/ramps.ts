// Views of every width that take integers made of the index: the index itself, masks, remainders of powers of two, steps, bounds around the width of a vector.
function show(v: ArrayLike<number>) { let t = 17; for (let i = 0; i < v.length; i++) t = (Math.imul(t, 31) + (v[i] | 0)) | 0; return [v.length, t, v[0], v[17], v[v.length - 1]].join(); }
function bytes(v: Uint8Array, c: number) { for (let i = 0; i < v.length; i++) v[i] = i; for (let i = 1; i < v.length; i += 1) v[i] = (i + 3) & 63; for (let i = 0; i < v.length; i++) v[i] = i % 16 + (v[i] ^ 5); for (let i = 0; i < v.length; i++) v[i] = (i + c) % 256; return show(v); }
function signedBytes(v: Int8Array) { for (let i = 0; i < v.length; i++) v[i] = i; const a = show(v); for (let i = 0; i < v.length; i++) v[i] = (v[i] + i) % 128; const b = show(v); for (let i = 0; i < v.length; i++) v[i] = v[i] - 2 * i; return a + " " + b + " " + show(v); }
function clamped(v: Uint8ClampedArray) { for (let i = 0; i < v.length; i++) v[i] = i; const a = show(v); for (let i = 0; i < v.length; i++) v[i] = (i + 7) % 64; return a + " " + show(v); }
function halves(v: Int16Array, u: Uint16Array) { for (let i = 0; i < v.length; i++) v[i] = i - 5; const a = show(v); for (let i = 0; i < u.length; i++) u[i] = (i + 1) % 1024; for (let i = 0; i < v.length; i++) v[i] = u[i] ^ i; return a + " " + show(u) + " " + show(v); }
function words(v: Int32Array, u: Uint32Array) { for (let i = 0; i < v.length; i++) v[i] = i; for (let i = 0; i < u.length; i++) u[i] = (i + 9) % 4096; const a = show(v) + " " + show(u); for (let i = 0; i < v.length; i++) v[i] = (i * 3) % 32 - i; return a + " " + show(v); }
function singles(v: Float32Array) { for (let i = 0; i < v.length; i++) v[i] = i % 8; return show(v); }
for (const n of [1, 15, 16, 17, 31, 32, 33, 64, 100, 255, 256, 257, 4096, 70001]) {
  for (const c of [0, 1, 255, -1, -300, 0.5, 2147483647, 4294967295, NaN]) console.log(n, c, bytes(new Uint8Array(n), c));
  console.log(n, signedBytes(new Int8Array(n)), clamped(new Uint8ClampedArray(n)), halves(new Int16Array(n), new Uint16Array(n)), words(new Int32Array(n), new Uint32Array(n)), singles(new Float32Array(n)));
}
