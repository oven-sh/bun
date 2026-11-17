// Reductions over bytes and halfwords, with the index in the term: lengths around the vectors, starts, every kind of view, sums that wrap.
const kinds = [Uint8Array, Int8Array, Uint8ClampedArray, Uint16Array, Int16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
const fill = (view, seed) => { for (let i = 0; i < view.length; i++) view[i] = Math.imul(i + seed, 2654435761) >>> (i % 13); return view; };
function hash(view) { let sum = 0; for (let i = 0; i < view.length; i++) sum ^= (i * view[i]) | 0; return sum; }
function products(view, first, factor) { let sum = 1; for (let i = first; i < view.length; i++) sum = (sum + factor * view[i] * (i + 3)) | 0; return sum; }
function masks(view, n) { let all = -1, some = 0; for (let i = 0; i < n; i++) { all &= view[i] | i; some |= view[i] & ~i; } return all + "," + some; }
function downwards(view, n) { let sum = 0, left = n; for (let i = 0; i < n; i++) { sum ^= left * view[i]; left--; } return sum + "," + left; }
function spread(view, words) { for (let i = 0; i < words.length; i++) words[i] = view[i] * 70000 + i; let sum = 0; for (let i = 0; i < words.length; i++) sum ^= words[i]; return sum; }
function shifted(view, n) { let sum = 0; for (let i = 0; i < n; i++) sum ^= (view[i] << 25) ^ ((view[i] * 1000003) >>> 5); return sum; }
function wide(view) { let sum = 0; for (let i = 0; i < view.length; i++) sum += i * view[i]; return sum; }
const said = [];
for (const kind of kinds) {
  for (const length of [0, 1, 3, 4, 7, 8, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 1000]) {
    const view = fill(new kind(new ArrayBuffer((length + 3) * kind.BYTES_PER_ELEMENT), 2 * kind.BYTES_PER_ELEMENT, length), length);
    said.push([kind.name, length, hash(view), products(view, 0, 3), products(view, 5, -70000), products(view, 1, 0.5), masks(view, length), masks(view, length + 2), downwards(view, length), spread(view, new Int32Array(length)), spread(view, new Uint32Array(length + 1)), spread(view, kind === Uint8Array ? new Int32Array(view.buffer.slice(0), 0, length >> 2) : new Int16Array(length)), shifted(view, length), wide(view)].join(" "));
  }
}
console.log(said.join("\n"));
const shared = new Uint8Array(400); console.log(spread(shared, new Int32Array(shared.buffer)), spread(new Uint8Array(shared.buffer, 4, 90), new Int32Array(shared.buffer, 0, 90)), hash(shared));
const growing = new Uint8Array(new ArrayBuffer(100, { maxByteLength: 200 })); fill(growing, 9); console.log(hash(growing)); growing.buffer.resize(150); console.log(hash(growing)); growing.buffer.resize(10); console.log(hash(growing));
const gone = fill(new Uint8Array(100), 1); console.log(hash(gone)); gone.buffer.transfer(); console.log(hash(gone), products(gone, 0, 2), masks(gone, 100));
const large = fill(new Uint8Array(3000000), 4); console.log(hash(large), products(large, 0, 7), downwards(large, 3000000), wide(large));
