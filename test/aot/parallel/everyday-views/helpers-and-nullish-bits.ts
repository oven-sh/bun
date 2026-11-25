// Reads of views by helpers that loops call with their counters, and bit operators on elements that may be missing.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : ArrayBuffer.isView(v) ? "[" + Array.prototype.join.call(v, " ") + "]" : String(v)) + " "; log += "\n"; }
function at(list: Int32Array, i: number): number { return list[i]; }
function atByte(list: Uint8Array, i: number): number { return list[i]; }
function either(list: Uint8Array | number[], i: number): number { return list[i]; }
function put(list: Uint8ClampedArray, i: number, x: number): void { list[i] = x; }
function swap(list: Uint16Array, i: number, j: number): void { const held = list[i]; list[i] = list[j]; list[j] = held; }
function deeper(list: Int32Array, i: number): number { return at(list, i) + 1; }
function shifted(list: Int32Array, i: number): number { return list[i + 1]; }
function orZero(list: Uint8Array, i: number): number { return list[i] | 0; }
function masked(list: Uint8Array, i: number): number { return list[i] & 255; }
function halved(list: Uint8Array, i: number): number { return list[i] >> 1; }
function unsigned(list: Int8Array, i: number): number { return list[i] >>> 0; }
function flipped(list: Uint8Array, i: number): number { return ~list[i]; }
function nullish(x: number | null | undefined): number { return (x! | 0) + (x! ^ 3) + (x! << 1) + (x! >>> 1) + (~x!); }
class Grid {
  constructor(readonly cells: Uint8Array, readonly wide: Int32Array) {}
  get(i: number): number { return this.cells[i]; }
  set(i: number, x: number): void { this.cells[i] = x; }
  sum(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += this.get(i); return t; }
  both(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += this.get(i) * at(this.wide, i); return t; }
  fill(n: number): void { for (let i = 0; i < n; i++) this.set(i, i * 3); }
}
function sums(v: Int32Array, n: number): number { let t = 0; for (let i = 0; i < n; i++) t += at(v, i); return t; }
function sumsDeep(v: Int32Array, n: number): number { let t = 0; for (let i = 0; i < n; i++) t += deeper(v, i); return t; }
function sumsShifted(v: Int32Array, n: number): number { let t = 0; for (let i = 0; i < n; i++) t += shifted(v, i); return t; }
function sumsEither(v: Uint8Array | number[], n: number): number { let t = 0; for (let i = 0; i < n; i++) t += either(v, i); return t; }
function sumsFrom(v: Uint8Array, from: number, n: number): number { let t = 0; for (let i = from; i < n; i++) t += atByte(v, i); return t; }
function down(v: Uint8Array, n: number): number { let t = 0; for (let i = n; i >= 0; i--) t += atByte(v, i); return t; }
function bits(v: Uint8Array, w: Int8Array, n: number): number { let t = 0; for (let i = 0; i < n; i++) t += orZero(v, i) * 3 + masked(v, i) + halved(v, i) + unsigned(w, i) + flipped(v, i); return t; }
function clamp(v: Uint8ClampedArray, n: number): void { for (let i = 0; i < n; i++) put(v, i, i * 40 - 60.5); }
function reverse(v: Uint16Array, n: number): void { for (let i = 0, j = n - 1; i < j; i++, j--) swap(v, i, j); }
function reverseClamped(v: Uint8ClampedArray): void { for (let i = 0, j = v.length - 1; i < j; i++, j--) { const held = v[i]; v[i] = v[j]; v[j] = held; } }
function shrinking(v: Uint8Array, buffer: ArrayBuffer, n: number): string { let t = ""; for (let i = 0; i < n; i++) { t += atByte(v, i) + " "; if (i === 2) buffer.resize(4); if (i === 5) buffer.resize(12); } return t; }
function replaced(a: Int32Array, b: Int32Array, n: number): number { let t = 0, v = a; for (let i = 0; i < n; i++) { t += at(v, i) | 0; if (i === 3) v = b; } return t; }
const captured = Int32Array.from({ length: 9 }, (_, i) => i * 1000 - 3);
const ofCaptured = (n: number): number => { let t = 0; for (let i = 0; i < n; i++) t += at(captured, i); return t; };
for (let round = 0; round < 4; round++) {
  for (const n of [0, 1, 4, 8, 9, 10, 12, 0.5, 8.5, -1, NaN, "7" as any, undefined as any, 13]) {
    const wide = Int32Array.from({ length: 9 }, (_, i) => i * 1000003 - 5), bytes = Uint8Array.from({ length: 9 }, (_, i) => 250 + i), signed = Int8Array.from({ length: 9 }, (_, i) => i * 37);
    const grid = new Grid(bytes, wide), clamped = new Uint8ClampedArray(9), words = Uint16Array.from({ length: 9 }, (_, i) => i * 7001);
    show(n, sums(wide, n), sumsDeep(wide, n), sumsShifted(wide, n), sumsEither(bytes, n), sumsEither([1, 2, 3, 4], n), sumsFrom(bytes, 2, n), down(bytes, n), bits(bytes, signed, n), grid.sum(n), grid.both(n), ofCaptured(n));
    clamp(clamped, n); reverse(words, n); show(clamped, words); grid.fill(n); show(bytes, Object.keys(bytes).length); reverseClamped(clamped); show(clamped, replaced(wide, captured, n), replaced(wide, new Int32Array(2), n));
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 }); const view = new Uint8Array(buffer); view.fill(6); show(shrinking(view, buffer, n));
  }
  for (const from of [-1, -2, 0.5, NaN, 3]) show(sumsFrom(Uint8Array.of(1, 2, 3, 4), from, 5));
  show(nullish(undefined), nullish(null), nullish(5), nullish(-1), nullish(4294967295), nullish(2.5), nullish(NaN), nullish(-0));
  const gone = Int32Array.of(4, 5, 6); structuredClone(gone.buffer, { transfer: [gone.buffer as ArrayBuffer] }); show(sums(gone, 3), sumsDeep(gone, 2));
  try { show(sums(undefined as any, 2)); } catch (error: any) { show(error.constructor.name); }
}
console.log(log.length, log);
