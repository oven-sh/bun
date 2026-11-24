const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array] as const;
function readWords(view: Int32Array, k: number): number | undefined { return view[k | 0]; }
function readHalves(view: Uint16Array, k: number): number | undefined { return view[k | 0]; }
function readBytes(view: Uint8Array, k: number): number | undefined { return view[k | 0]; }
function readDoubles(view: Float64Array, k: number): number | undefined { return view[k | 0]; }
function storeWords(view: Int32Array, k: number, x: number): void { view[k | 0] = x; }
function storeDoubles(view: Float64Array, k: number, x: number): void { view[k | 0] = x; }
function down(view: Float32Array): number { let s = 0; for (let i = view.length - 1; i >= 0; i--) s += view[i]; return s; }
function downPast(view: Int16Array, from: number): string { let s = ""; for (let i = from | 0; i >= -2; i--) s += view[i] + ","; return s; }
function up(view: Int32Array): void { for (let i = 0; i < view.length; i++) view[i] = view[i] * 3 + i; }
const places = [0, 1, 2, 3, 4, 5, -1, -2, 2147483647, -2147483648, 1073741824, -1073741824, 65536];
const words = new Int32Array([1, 2, 3, 4]), halves = new Uint16Array([5, 6, 7, 8]), bytes = new Uint8Array([9, 10, 11, 12]), doubles = new Float64Array([0.5, 1.5, 2.5, 3.5]);
for (const k of places) {
  console.log(k, readWords(words, k), readHalves(halves, k), readBytes(bytes, k), readDoubles(doubles, k));
  storeWords(words, k, k); storeDoubles(doubles, k, k + 0.5);
}
console.log(words.join(","), doubles.join(","));
console.log(down(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])), down(new Float32Array(0)), downPast(new Int16Array([1, 2, 3]), 4));
const many = new Int32Array(21).fill(1); up(many); up(many); console.log(many.join(","));
const buffer = new ArrayBuffer(16, { maxByteLength: 64 }); const follows = new Int32Array(buffer);
for (const size of [16, 32, 8, 0, 64]) { buffer.resize(size); console.log(size, follows.length, readWords(follows, 3), readWords(follows, 7), readWords(follows, -1)); storeWords(follows, 3, size); }
for (const kind of kinds) { const view = new kind(3); console.log(kind.name, view[-1 | 0], view[3 | 0], view[2 | 0]); }
