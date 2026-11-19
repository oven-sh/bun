// Loops over views to numbers of every kind, of views in variables, fields, private fields and inner objects; fields that change on the way, views that shrink, grow and go away.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : ArrayBuffer.isView(v) ? "[" + Array.prototype.join.call(v, " ") + "]" : typeof v === "object" && v ? JSON.stringify(v) : String(v)) + ","; log += ";"; }
class Inner { data: Uint8Array; constructor(n: number) { this.data = Uint8Array.from({ length: n }, (_, i) => i * 7); } }
class Holder {
  view: Int32Array; bytes: Uint8Array; doubles: Float64Array; clamped: Uint8ClampedArray; inner: Inner; total = 0; at = 0; #hidden: Uint16Array;
  constructor(n: number) { this.view = Int32Array.from({ length: n }, (_, i) => i * 1000003 - 5); this.bytes = Uint8Array.from({ length: n }, (_, i) => i * 37); this.doubles = Float64Array.from({ length: n }, (_, i) => i / 4 - 1); this.clamped = Uint8ClampedArray.from(this.bytes); this.inner = new Inner(n); this.#hidden = Uint16Array.from({ length: n }, (_, i) => i * 5001); }
  sum(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += this.bytes[i]; return t; }
  sumWritten(): number { let t = 0; for (let i = 0; i < 12; i++) t += this.view[i]; return t; }
  cut(n: number): number { let t = 0; for (let i = 0; i < n; i++) t = (t + this.view[i]) | 0; return t; }
  product(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += this.bytes[i] * this.bytes[i + 1]; return t; }
  add(n: number, d: number): void { for (let i = 0; i < n; i++) this.bytes[i] += d; }
  addView(n: number, d: number): void { for (let i = 0; i < n; i++) this.view[i] += d; }
  addDoubles(n: number, d: number): void { for (let i = 0; i < n; i++) this.doubles[i] += d; }
  step(n: number): void { for (let i = 0; i < n; i++) this.clamped[i]++; }
  copy(n: number): void { for (let i = 0; i < n; i++) this.bytes[i] = this.view[i]; }
  copyInner(n: number): number { for (let i = 0; i < n; i++) this.inner.data[i] = this.bytes[i + 1]; let t = 0; for (let i = 0; i < n; i++) t = t * 3 + this.inner.data[i]; return t; }
  hidden(n: number): number { let t = 0; for (let i = 0; i < n; i++) { this.#hidden[i]++; t += this.#hidden[i]; } return t; }
  replaced(n: number): string { let t = ""; for (let i = 0; i < n; i++) { t += this.bytes[i] + " "; if (i === 3) this.bytes = new Uint8Array([9, 8, 7, 6, 5]); } return t; }
  replacedByCall(n: number): string { let t = ""; for (let i = 0; i < n; i++) { t += this.bytes[i] + " "; if (i === 2) this.renew(); } return t; }
  renew(): void { this.bytes = new Uint8Array(4).fill(3); }
  counted(n: number): number { for (let i = 0; i < n; i++) this.total += this.view[i] & 255; return this.total; }
  cursor(): number { let t = 0; this.at = 0; while (this.at < this.bytes.length) t = t * 2 + this.bytes[this.at++]; return t; }
  nested(n: number): number { let t = 0; for (let y = 0; y < 3; y++) for (let i = 0; i < n; i++) t += this.bytes[i] * y; return t; }
  both(o: Holder, n: number): number { let t = 0; for (let i = 0; i < n; i++) { o.bytes[i] = this.bytes[i] + 1; t += o.bytes[i]; } return t; }
  from(a: number, b: number): number { let t = 0; for (let i = a; i < b; i++) t = t * 3 + (this.view[i] ?? 7) % 101; return t; }
  less(n: number): number { let t = 0; for (let i = 0; i <= n; i++) t += this.bytes[i]; return t; }
  turned(n: number): number { let t = 0; for (let i = 0; n > i; i++) t += this.bytes[i]; return t; }
}
function shrink(v: Uint8Array, buffer: ArrayBuffer, n: number): string { let t = ""; for (let i = 0; i < n; i++) { t += v[i] + " "; if (i === 2) buffer.resize(4); if (i === 5) buffer.resize(10); } return t; }
function detach(v: Uint8Array, n: number): string { let t = ""; for (let i = 0; i < n; i++) { t += v[i] + " "; if (i === 2) structuredClone(v.buffer, { transfer: [v.buffer as ArrayBuffer] }); v[i] = 5; } return t; }
function local(v: Uint8Array, n: number): number { let t = 0; for (let i = 0; i < n; i++) t += v[i] + v[i + 2]; return t; }
function either(v: Uint8Array | number[], n: number): number { let t = 0; for (let i = 0; i < n; i++) t += v[i]; return t; }
function table(v: Uint8Array, keys: Uint8Array, n: number): number { let t = 0; for (let i = 0; i < n; i++) t = t * 5 + v[keys[i] & 7]; return t; }
const bounds: any[] = [0, 1, 5, 11, 12, 13, 16, -1, -0, 0.5, 11.5, 12.000001, NaN, 2147483647.5, 4294967296.5, "7", "x", null, undefined, true, 20];
const small = (n: any): boolean => !(Number(n) > 1e6);
for (let round = 0; round < 4; round++) {
  for (const n of bounds) {
    if (!small(n)) { continue; }
    const h = new Holder(12);
    show(h.sum(n), h.sumWritten(), h.cut(n), h.product(n), h.hidden(n), h.counted(n), h.cursor(), h.nested(n), h.from(0, n), h.from(3, n), h.less(n), h.turned(n), local(h.bytes, n), either(h.bytes, n), either([1, 2.5, 3], n), table(h.bytes, h.inner.data, n));
    h.add(n, 3); h.add(n, 0.75); h.addView(n, -7); h.addView(n, 1e10); h.addDoubles(n, 0.5); h.step(n); show(h.bytes, h.view, h.doubles, h.clamped);
    h.copy(n); show(h.bytes, h.copyInner(n), h.inner.data); show(h.both(new Holder(5), n), h.both(h, n), h.bytes, h.replaced(n), h.replacedByCall(n));
    show(Object.keys(h.bytes).length, Object.keys(h.view).length);
    const buffer = new ArrayBuffer(8, { maxByteLength: 16 }), v = new Uint8Array(buffer); v.fill(7); show(shrink(v, buffer, n), v); const gone = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]); show(detach(gone, n), gone.length);
  }
  const bare: any = Object.create(Holder.prototype); try { bare.sum(3); } catch (error: any) { show(error.constructor.name); } bare.bytes = [1, 2, 3]; show(bare.sum(3), bare.sum(5), bare.product(2)); bare.bytes = "abc"; show(bare.sum(2)); let reads = 0; Object.defineProperty(bare, "view", { get() { reads++; return new Int32Array([1, 2, 3]); }, configurable: true }); show(bare.cut(3), reads);
  show(new Holder(0).sum(3), new Holder(0).product(2), new Holder(3).sumWritten());
}
console.log(log.length, log);
