// A bounds check that is known to fail answers its read: undefined. The speculation on the element does not open again.
// STATISTIC: TypedArrayReadsFolded >= 6
const h = new Uint16Array([7, 6, 5, 4, 3, 2, 1, 9]), doubles = new Float64Array([0.5, 1.5, 2.5, 3.5]), none = new Int32Array(0);
const bytes = new Uint8Array([1, 2, 3, 4]);
function subtracted(y) { for (let i = 0; i < 4; i++) { h[y - (y & ~7)] += 1; } }
function stored(y) { for (let i = 0; i < 4; i++) { doubles[y] = doubles[y] + 1; } }
function negative(y) { let s = 0; for (let i = 0; i < 4; i++) { bytes[y] ^= 1; s += bytes[y] | 0; } return s; }
function empty(n) { for (let i = 0; i < n; i++) { none[i] += 1; } return none[0]; }
function besides(y) { let s = 0; for (let i = 0; i < 4; i++) { s += h[i] + doubles[i]; bytes[y + 8] += 1; } return s; }
function inWhile(y) { let n = 0; while (n < 4) { h[y + 1]++; n++; } return n; }
function nested(y) { let s = 0; for (let i = 0; i < 2; i++) { for (let k = 0; k < 3; k++) { h[y] += 1; s += h[k]; } } return s; }
async function awaited(y) { for (let i = 0; i < 3; i++) { h[y] += 1; if (i === 1) await null; } return h[y]; }
function recursive(y, n) { h[y] += 1; return n ? recursive(y, n - 1) : h[y]; }
subtracted(2 ** 32 + 3); subtracted(2 ** 40 + 5); subtracted(2 ** 32); console.log(h.join());
stored(2 ** 32 + 3); stored(2 ** 40); stored(4); console.log(doubles.join());
console.log(negative(-1), negative(-5), negative(-4294967296), bytes.join());
console.log(empty(4), none.length, besides(2 ** 32), besides(0), besides(-9), bytes.join());
console.log(inWhile(2 ** 32), inWhile(2 ** 33), nested(2 ** 32), nested(2 ** 41), h.join());
console.log(await awaited(2 ** 32), await awaited(2 ** 34), recursive(2 ** 32, 4), recursive(2 ** 35, 2), h.join());
console.log([2 ** 32, 2 ** 33].map(y => { h[y] += 1; return h[y]; }), [0, 1, 2].map(i => bytes[i - 8]), h.join());
