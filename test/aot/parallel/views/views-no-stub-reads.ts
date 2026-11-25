// Views whose elements no stub reads, met by code that has read others: under integers that loops count, under doubles and strings, in and out of range.
function paint(cache: any): any { let all: any = 0; for (let t = 0; t < 4; t++) { const tile = cache[t]; for (let i = 0; i < 4; i++) all = tile[i] | (t << 1); } return all; }
function sum(cache: any): any { let all: any = 0; for (let t = 0; t < 4; t++) all += cache[t][t]; return all; }
function at(view: any, i: number): any { return view[i]; }
function within(view: any, from: number, to: number): any[] { const found: any[] = []; for (let i = from; i < to; i++) found.push(view[i]); return found; }
function compound(view: any, n: number): any { for (let i = 0; i < n; i++) { view[i] += view[i]; view[i]++; } return view; }
function compare(view: any, n: number): number { let k = 0; for (let i = 0; i < n; i++) if (view[i] === view[i]) k++; return k; }
const Half = (globalThis as any).Float16Array;
const kinds: any[] = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, ...(Half ? [Half] : [])];
const lines: string[] = [];
function attempt(what: string, f: () => any): void {
  let t: string;
  try { const v = f(); t = typeof v === "bigint" ? `${v}n` : Array.isArray(v) ? v.map(String).join() : Object.is(v, -0) ? "-0" : String(v); } catch (error: any) { t = `${error.constructor.name}`; }
  lines.push(`${what} ${t}`);
}
for (const K of kinds) {
  const one = K === BigInt64Array || K === BigUint64Array ? (n: number) => BigInt(n) : (n: number) => n;
  const cache: any[] = [1, 2, 3, 4].map(n => new Uint8Array(4).fill(n));
  attempt(`${K.name} paint bytes`, () => paint(cache)); attempt(`${K.name} sum bytes`, () => sum(cache));
  for (let place = 0; place < 4; place++) {
    const mixed = cache.slice(); const other: any = new K(4); for (let i = 0; i < 4; i++) other[i] = one(i + 1); mixed[place] = other;
    attempt(`${K.name} paint ${place}`, () => paint(mixed)); attempt(`${K.name} sum ${place}`, () => sum(mixed));
  }
  const view: any = new K(6); for (let i = 0; i < 6; i++) view[i] = one(i * 3 + 1);
  for (const i of [0, 1, 5, 6, -1, 1.5, NaN, -0, 2147483647, 2147483648, -2147483648, 4294967295, 4294967296, 2 ** 52, 1e20]) attempt(`${K.name} at ${i}`, () => at(view, i));
  attempt(`${K.name} within`, () => within(view, -2, 8));
  attempt(`${K.name} compare`, () => compare(view, 6));
  attempt(`${K.name} compound`, () => within(compound(new K(view), 6), 0, 6));
  const buffer = new ArrayBuffer(64, { maxByteLength: 128 }); const tracking: any = new K(buffer); const fixed: any = new K(buffer, 8, 2);
  attempt(`${K.name} tracking`, () => within(tracking, 0, 4)); attempt(`${K.name} fixed`, () => within(fixed, 0, 4));
  buffer.resize(12); attempt(`${K.name} shorter`, () => within(tracking, 0, 4)); attempt(`${K.name} out of bounds`, () => within(fixed, 0, 4));
  const shared: any = new K(new SharedArrayBuffer(32)); attempt(`${K.name} shared`, () => within(shared, 0, 5));
  const gone: any = new K(4); structuredClone(gone.buffer, { transfer: [gone.buffer] }); attempt(`${K.name} gone`, () => within(gone, 0, 3)); attempt(`${K.name} gone at`, () => at(gone, 1));
}
const data: any = new DataView(new ArrayBuffer(8)); data[1] = "own"; attempt("DataView", () => within(data, 0, 3)); attempt("DataView sum", () => sum([data, data, data, data]));
for (const line of lines) console.log(line);
