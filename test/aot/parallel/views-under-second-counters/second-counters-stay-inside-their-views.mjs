// Views accessed under what a loop steps beside its counter. All that the iterations can reach is checked before the loop: some loops stay inside, some leave at either end, some change what the check was made of.
const show = v => { let t = 0; for (let i = 0; i < v.length; i++) t = (Math.imul(t, 31) + (v[i] * 16 | 0)) | 0; return v.length + ":" + t; };
const numbers = (Kind, n) => new Kind(n).map((_, i) => i * 37 % 120);
function pack(from, to, n) { let p = 0; for (let i = 0; i < n; i++) { const w = from[i]; to[p] = w & 255; to[p + 1] = w >> 8 & 255; to[p + 2] = w >> 16 & 255; to[p + 3] = w >>> 24; p += 4; } return p; }
function unpack(from, to, n) { let p = n * 4 - 4; for (let i = n - 1; i >= 0; i--) { to[i] = from[p] | from[p + 1] << 8 | from[p + 2] << 16 | from[p + 3] << 24; p -= 4; } return p; }
function transpose(from, to, width, height) { let s = 0; for (let y = 0; y < height; y++) { let at = y * width, dst = y + height * (width - 1); at += width - 1; for (let x = width - 1; x >= 0; x--) { to[dst] = from[at] & 1023; s += from[at]; at--; dst -= height; } } return s; }
function strides(from, to, width, height) { let s = 0; for (let x = 0; x < width; x++) { let a = x, b = x * height; for (let y = 0; y < height; y++) { to[b] = from[a] * 2; s += to[b]; a += width; b++; } } return s; }
function inclusive(v, n) { let p = 1, s = 0; for (let i = 0; i <= n; i++) { s += v[p - 1] | 0; s += v[p] | 0; p++; } return s + " " + p; }
function backwards(v, n) { let p = n, s = 0; for (let i = 0; n > i; i++) { s += v[p] * 2; p--; } return s + " " + p; }
function byTwo(v, n) { let p = 0, q = 9, s = 0; for (let i = 0; i < n; i += 2) { s += v[p] * 3 - v[q + 2]; p += 3; q -= 1; } return s + " " + p + " " + q; }
function leaves(v, n, at) { let p = 0, s = 0; for (let i = 0; i < n; i++) { if (v[p] === at) break; s += v[p + 1] * 2; p += 2; } return s + " " + p; }
function jumps(v, n, at, by) { let p = 0, s = 0; for (let i = 0; i < n; i++) { s += v[p] * 2; if (i === at) p += by; p++; } return s + " " + p; }
function replaced(v, w, n, at) { let p = 0, s = 0; for (let i = 0; i < n; i++) { if (i === at) v = w; s += v[p] * 2; v[p] = i; p++; } return s + " " + show(v); }
function bounds(v, n, at, to) { let p = 0, s = 0, end = n; for (let i = 0; i < end; i++) { s += v[p] * 2; v[p] = i; if (i === at) end = to; p++; } return s + " " + p; }
function shrinks(v, n, at) { let p = 0, s = 0; for (let i = 0; i < n; i++) { s += v[p] * 2; v[p] = i; if (i === at) v.buffer.resize(v.buffer.byteLength >> 1); p++; } return s + " " + p; }
function detaches(v, n, at) { let p = 0, s = 0; for (let i = 0; i < n; i++) { s += v[p] * 2; v[p] = i; if (i === at) v.buffer.transfer(); p++; } return s + " " + p; }
function starts(v, n, from) { let p = from, s = 0; for (let i = 0; i < n; i++) { s += v[p] * 2; v[p] += 1; p++; } return s + " " + p; }
function nested(v, rows, n) { let s = 0, p = 0; for (let y = 0; y < rows; y++) { for (let x = 0; x < n; x++) { s += v[p] * 2; p++; } p -= n - 1; } return s + " " + p; }
for (const Kind of [Uint8Array, Uint8ClampedArray, Int16Array, Uint32Array, Float32Array, Float64Array]) {
  for (const short of [0, 1, 3, 4, 40]) {
    const from = numbers(Uint32Array, 10).map(x => Math.imul(x + 1, 2654435761)), to = new Kind(40 - short);
    console.log(Kind.name, short, pack(from, to, 10), show(to), unpack(to, from, 10), show(from), pack(from, to, 0), unpack(to, from, 0));
    const image = numbers(Kind, 35 - short % 35), turned = new Float64Array(35 - short % 35);
    console.log(transpose(image, turned, 7, 5), show(turned), strides(image, turned, 7, 5), show(turned), transpose(image, turned, 1, 5), transpose(image, turned, 5, 1), show(turned));
  }
  for (const n of [0, 1, 2, 9, 10, 11]) {
    const v = numbers(Kind, 10);
    console.log(n, inclusive(v, n), backwards(v, n), byTwo(v, n), leaves(v, n, 74), leaves(v, n, 111), jumps(v, n, 3, 1), jumps(v, n, 3, -9), jumps(v, n, 4, 1e6));
    console.log(replaced(numbers(Kind, 10), numbers(Int8Array, 4), n, 2), replaced(numbers(Kind, 10), numbers(Float64Array, 12), n, 5), bounds(v, n, 2, 14), bounds(v, n, 2, 1), starts(v, n, -2), starts(v, n, 3), starts(v, n, 2 ** 31), nested(v, 3, n), show(v));
  }
  const growable = new Kind(new ArrayBuffer(10 * Kind.BYTES_PER_ELEMENT, { maxByteLength: 400 }));
  console.log(shrinks(growable, 10, 2), show(growable), shrinks(growable, 10, 20), detaches(numbers(Kind, 10), 10, 4), detaches(numbers(Kind, 10), 8, 20));
}
