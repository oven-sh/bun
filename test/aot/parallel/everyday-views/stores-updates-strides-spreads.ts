// Views: stores of undefined and of numbers of every kind, updates under keys outside, strided loops to every kind of length, spreads.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : ArrayBuffer.isView(v) ? "[" + Array.prototype.join.call(v, " ") + "]" : typeof v === "object" && v ? JSON.stringify(v) : String(v)) + ","; log += ";"; }
const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array] as any[];
const make = (kind: any, n = 12): any => kind.from({ length: n }, (_: any, i: number) => i * 23 - 7);
function swap(v: Uint8ClampedArray): void { for (let i = 0, k = v.length - 1; i < k; i++, k--) { const held = v[i]; v[i] = v[k]; v[k] = held; } }
function shift(v: Uint8ClampedArray, by: number): void { for (let i = 0; i < 12; i++) v[i] = v[i + by]; }
function put(v: Uint8ClampedArray, values: any[]): void { for (let i = 0; i < values.length; i++) v[i] = values[i]; }
function putNumbers(v: Uint8ClampedArray, values: number[]): void { for (let i = 0; i < values.length; i++) v[i] = values[i]; }
function copyAny(v: any, u: any): void { for (let i = 0; i < 14; i++) u[i] = v[i]; }
function blend(v: Uint8ClampedArray, u: Uint8ClampedArray): void { for (let i = 0; i < 12; i++) v[i] = v[i] * 0.3 + u[i + 2] * 0.7; }
function step(v: any, n: number): void { for (let i = 0; i < n; i++) v[i]++; }
function stepTyped(v: Int8Array, n: number): void { for (let i = 0; i < n; i++) v[i]++; }
function stepWritten(v: Uint8Array): void { for (let i = 0; i < 16; i++) v[i]++; }
function down(v: Int16Array): void { for (let i = 0; i < 16; i++) --v[i]; }
function addTo(v: Int32Array, from: number): number { let t = 0; for (let i = from; i < 16; i++) t = v[i] += i; return t; }
function addFloat(v: Float64Array): void { for (let i = 0; i < 16; i++) v[i] += 0.5; }
function updateBoth(v: Uint16Array, u: Uint16Array): void { for (let i = 0; i < 14; i++) { v[i] |= 1; u[i + 1] ^= v[i]; u[i]--; } }
function result(v: Int8Array): string { let text = ""; for (let i = 0; i < 14; i++) text += v[i]++ + ":" + ++v[i] + " "; return text; }
function stride(v: any): number { let t = 0; for (let i = 0; i + 3 < v.length; i += 4) t = t * 3 + (v[i] + v[i + 1] * 2 + v[i + 3]) % 1009; return t; }
function strideTyped(v: Uint8Array): number { let t = 0; for (let i = 0; i + 3 < v.length; i += 4) t += v[i] + v[i + 1] * 2 + v[i + 3]; return t; }
function strideStep(v: Float64Array): number { let t = 0; for (let i = 0; i < v.length; i += 5) t += v[i] + v[i + 4]; return t; }
function strideList(v: number[]): number { let t = 0; for (let i = 0; i + 1 <= v.length; i += 2) t += v[i] + (v[i + 1] ?? 5); return t; }
function strideText(v: string): string { let t = ""; for (let i = 0; i + 1 < v.length; i += 2) t += v[i + 1] + v[i] + v.charCodeAt(i); return t; }
function strideDown(v: Uint8Array): number { let t = 0; for (let i = 2; i - 2 < v.length; i += 3) t = t * 2 + v[i - 2]; return t; }
function strideNegative(v: Uint8Array): number { let t = 0; for (let i = 0; i + -1 < v.length; i += 4) t = t * 2 + (v[i] ?? 9); return t; }
function strideOdd(v: { length: any }): number { let t = 0; for (let i = 0; i + 1 < v.length && t < 40; i += 3) t++; return t; }
function strideBig(from: number, to: number): string { let t = ""; for (let i = from; i + 2 < to; i += 2) t += i + " "; return t; }
function strideMixed(v: Uint8Array): number { let t = 0; for (let i = 0; i < v.length; ) { t += v[i]; if (t & 1) i += 3; else i++; } return t; }
function strideBefore(v: Uint8Array): number { let t = 0, i = -1; while (++i < v.length) t = t * 2 + v[i]; i = 0; while (i++ < v.length) t += v[i] ?? 1; return t; }
const odd = [0, -0, 1.5, 2.5, 0.5, -0.5, 254.5, 255.5, 300, -5, NaN, Infinity, -Infinity, 4294967297, 1e300, -1e300, 127, 128, 255, 256];
for (let round = 0; round < 3; round++) {
  const c = make(Uint8ClampedArray); swap(c); show(c); shift(c, 1); show(c); shift(c, 5); show(c); shift(c, -2); show(c);
  const d = new Uint8ClampedArray(odd.length); putNumbers(d, odd); show(d); put(d, [...odd.slice(0, 5), undefined, null, true, false, "12.5", "x", [], [7], {}, { valueOf: () => 33.5 }]); show(d);
  blend(c, make(Uint8ClampedArray, 13)); show(c);
  for (const kind of kinds) for (const other of kinds) { const v = make(kind), u = make(other, 13); copyAny(v, u); show(u); }
  for (const kind of kinds) { const v = make(kind); step(v, 10); step(v, 16); show(v, stride(v), stride(make(kind, 3)), stride(make(kind, 16)), stride(new kind(0))); }
  const a = make(Int8Array); stepTyped(a, 16); stepTyped(a, 4); for (let i = 0; i < 260; i++) stepTyped(a, 5); show(a, result(a), a, Object.keys(a).length);
  const b = make(Uint8Array); stepWritten(b); show(b, Object.keys(b).length); const e = make(Int16Array); down(e); show(e);
  for (const from of [0, 3, 11, 12, 15, 16, -1, -3, 0.5, NaN, "2" as any, undefined as any]) { const v = make(Int32Array); show(addTo(v, from), v, Object.keys(v).length); }
  const f = make(Float64Array); addFloat(f); show(f); const g = make(Uint16Array), h = make(Uint16Array, 13); updateBoth(g, h); show(g, h); updateBoth(g, g); show(g);
  show(strideTyped(make(Uint8Array)), strideTyped(make(Uint8Array, 3)), strideStep(make(Float64Array)), strideStep(make(Float64Array, 15)), strideList([1, 2, 3, 4, 5]), strideList([]), strideList([1.5, , 3] as number[]), strideText("abcdefg"), strideText("日本語テキスト"), strideText(""), strideDown(make(Uint8Array)), strideNegative(make(Uint8Array, 8)), strideMixed(make(Uint8Array)), strideBefore(make(Uint8Array)));
  for (const length of [5, 5.5, "7", NaN, -1, undefined, null, Infinity, 4294967297, { valueOf: () => 6 }, true]) show(strideOdd({ length }));
  for (const [from, to] of [[0, 7], [4294967290, 4294967300], [2147483640, 2147483652], [9007199254740980, 9007199254740992], [-5, 3], [0.5, 6], [NaN, 5]]) show(strideBig(from, to));
  for (const kind of kinds) { const v = make(kind); show([...v], [1, ...v, 2], [..."ab", ...v], [0.5, ...v], [...v, ...v].length, Math.max(...v), [...new kind(0)], [...v.subarray(2, 5)]); }
  show([...new Float64Array([NaN, -0, 1, 1.5, 4294967296])], [...new Uint32Array([4294967295, 0])].map(x => x + 1), [...new Float32Array([0.1, NaN])], [...new BigInt64Array([1n, -5n])].map(String), [...Buffer.from("hey")]);
  const big = new Uint8Array(5000).fill(7); show([...big].length, [...big][4999], [...big, 1].length);
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 }); const r = new Uint8Array(buffer), fixed = new Uint8Array(buffer, 4, 4); r.fill(3); show([...r], [...fixed]); buffer.resize(6); show([...r]); try { show([...fixed]); } catch (error: any) { show(error.constructor.name); } buffer.resize(12); show([...r], [...fixed]);
  const gone = new Uint8Array(4); structuredClone(gone.buffer, { transfer: [gone.buffer] }); try { show([...gone]); } catch (error: any) { show(error.constructor.name); }
  class Mine extends Uint8Array { *[Symbol.iterator](): any { yield 9; yield 8; } } show([...new Mine(3)], [...new (class extends Uint8Array {})(2)]);
  const own: any = new Uint8Array([1, 2, 3]); own[Symbol.iterator] = function* () { yield 5; }; show([...own]);
}
console.log(log.length, log);
