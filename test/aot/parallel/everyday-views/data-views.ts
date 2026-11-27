// DataViews that nobody changes, and ones that get names, elements, another prototype, or lie over buffers that change their size or go away.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : String(v)) + " "; log += "\n"; }
function attempt(f: () => any): string { try { const v = f(); return typeof v === "bigint" ? v + "n" : String(v); } catch (error: any) { return error.constructor.name; } }
class Reader {
  at = 0;
  constructor(private view: DataView) {}
  u8(): number { return this.view.getUint8(this.at++); }
  i8(): number { return this.view.getInt8(this.at++); }
  u16(little?: boolean): number { const v = this.view.getUint16(this.at, little); this.at += 2; return v; }
  i32(little?: boolean): number { const v = this.view.getInt32(this.at, little); this.at += 4; return v; }
  u32(): number { const v = this.view.getUint32(this.at, true); this.at += 4; return v; }
  f64(): number { const v = this.view.getFloat64(this.at, true); this.at += 8; return v; }
  big(): bigint { const v = this.view.getBigInt64(this.at, true); this.at += 8; return v; }
  get left(): number { return this.view.byteLength - this.at; }
}
class Writer {
  at = 0;
  constructor(private view: DataView) {}
  u8(v: number): void { this.view.setUint8(this.at, v); this.at += 1; }
  u16(v: number): void { this.view.setUint16(this.at, v, true); this.at += 2; }
  f32(v: number): void { this.view.setFloat32(this.at, v, true); this.at += 4; }
  big(v: bigint): void { this.view.setBigUint64(this.at, v); this.at += 8; }
}
function make(n: number): DataView { return new DataView(Uint8Array.from({ length: n }, (_, i) => i * 37 + 5).buffer); }
function sum(view: DataView, n: number): number { let t = 0; for (let i = 0; i < n; i++) t = (t * 3 + view.getUint8(i)) % 1000003; return t; }
function words(view: DataView): number { let t = 0; for (let i = 0; i + 2 <= view.byteLength; i += 2) t = (t * 5 + view.getUint16(i, (i & 2) === 0)) % 1000003; return t; }
function tail(view: DataView): string { let t = ""; for (const at of [-1, -0, 0.5, NaN, "3", undefined, null, 1e10, true, {}] as any[]) t += attempt(() => view.getInt16(at)) + " "; return t; }
function readAll(reader: Reader): string { let t = ""; while (reader.left >= 28) t += [reader.u8(), reader.i8(), reader.u16(), reader.u16(true), reader.i32(), reader.i32(true), reader.u32(), reader.left].join(" ") + " "; return t; }
const held: { view: DataView } = { view: make(8) };
function heldSum(): number { let t = 0; for (let i = 0; i < 8; i++) t += held.view.getUint8(i); return t; }
for (let round = 0; round < 4; round++) {
  const view = make(64); show(sum(view, 64), words(view), tail(view), readAll(new Reader(view)), heldSum());
  const reader = new Reader(make(40)); show(reader.f64(), reader.big(), reader.u8(), reader.left, attempt(() => { for (;;) reader.u32(); }), reader.at);
  const target = make(64), writer = new Writer(target); for (let i = 0; i < 4; i++) { writer.u8(i * 77); writer.u16(i * 30000); writer.f32(i / 3); } writer.big(18446744073709551615n); show(writer.at, sum(target, 64)); show(attempt(() => { for (;;) writer.u16(1.9); }), writer.at);
  const named: any = make(8); named.getUint8 = (at: number) => at * 100; show(sum(named, 8), new Reader(named).u8(), new Reader(named).u16());
  const indexed: any = make(8); indexed[0] = "own"; indexed[5] = 1; show(sum(indexed, 8), indexed[0], indexed[1], new Reader(indexed).u16(), Object.keys(indexed).join());
  const other: any = make(8); Object.setPrototypeOf(other, { getUint8(at: number) { return 1000 + at; }, __proto__: DataView.prototype }); show(sum(other, 8), new Reader(other).u8(), new Reader(other).u16());
  const none: any = make(8); Object.setPrototypeOf(none, null); show(attempt(() => sum(none, 1)), attempt(() => new Reader(none).u16()));
  class Mine extends (DataView as any as new (buffer: ArrayBuffer) => DataView) { getUint8(at: number): number { return super.getUint8(at) + 10000; } } const mine = new Mine(new ArrayBuffer(8)); show(sum(mine, 8), new Reader(mine).u8(), new Reader(mine).u16(), words(mine));
  const frozen = Object.freeze(make(8)); show(sum(frozen, 8), new Reader(frozen).u16());
  const growing = new ArrayBuffer(8, { maxByteLength: 24 }), following = new DataView(growing), fixed = new DataView(growing, 2, 4); following.setUint32(0, 0x01020304); show(sum(following, 8), sum(fixed, 4), new Reader(following).left);
  growing.resize(20); show(sum(following, 20), new Reader(following).left, attempt(() => sum(fixed, 5))); growing.resize(4); show(attempt(() => sum(following, 4)), attempt(() => sum(following, 5)), attempt(() => sum(fixed, 1)), attempt(() => fixed.byteLength), attempt(() => new Reader(fixed).left));
  growing.resize(8); show(sum(following, 8), attempt(() => sum(fixed, 4)));
  const shared = new SharedArrayBuffer(4, { maxByteLength: 16 } as any), over = new DataView(shared); over.setInt8(1, -3); show(sum(over, 4)); (shared as any).grow(12); show(sum(over, 12), over.byteLength, new Reader(over).left);
  const gone = make(8); structuredClone(gone.buffer, { transfer: [gone.buffer as ArrayBuffer] }); show(attempt(() => sum(gone, 1)), attempt(() => new Reader(gone).u8()), attempt(() => gone.byteLength), attempt(() => new Writer(gone).u8(1)));
  show(attempt(() => sum(new Uint8Array(8) as any, 1)), attempt(() => new Reader({} as any).u8()), attempt(() => new Reader(undefined as any).u8()));
  if (round === 2) held.view = new DataView(new ArrayBuffer(4)); show(attempt(heldSum)); held.view = make(8);
}
console.log(log.length, log);
