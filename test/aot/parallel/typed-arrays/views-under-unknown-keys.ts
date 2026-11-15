// Every kind of view, value and key, by every way to read and write an element, in loops and out of them.
const Half = (globalThis as any).Float16Array;
const kinds: any[] = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, ...(Half ? [Half] : [])];
const values: any[] = [0, 1, -1, 200, -200, 70000, 2147483647, -2147483648, 0.5, 4294967296.5, NaN, Infinity, -0, true, undefined, null, "3", "x", 5n, -1n, 2n ** 63n, 2n ** 70n, {}, Symbol.iterator];
const keys: any[] = [0, 1, 3, 4, -1, 2147483647, 2147483648, -2147483648, 4294967295, 4294967296, 1e15, 1e21, 0.5, 1.5, NaN, -0, Infinity, "0", "1", "3", "4", "-0", "-1", "1.5", "01", "x", "1e3", 1n, 9n, true, null, undefined];
let hash = 0, count = 0;
function note(v: any): void { const t = typeof v === "symbol" ? "symbol" : typeof v === "object" && v !== null ? "object" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : String(v); for (let i = 0; i < t.length; i++) hash = (Math.imul(hash, 31) + t.charCodeAt(i)) | 0; count++; }
function attempt(f: () => any): void { try { note(f()); } catch (e: any) { note(e.constructor.name); } }
function read(o: any, k: any): any { return o[k]; }
function write(o: any, k: any, v: any): any { o[k] = v; }
function writeStrict(o: any, k: any, v: any): any { "use strict"; o[k] = v; }
function add(o: any, k: any, v: any): any { return (o[k] += v); }
function step(o: any, k: any): any { return o[k]++; }
function either(o: any, k: any, v: any): any { return (o[k] ??= v); }
function has(o: any, k: any): any { return k in o; }
function readAll(o: any, n: any): any { let s = ""; for (let i = -1; i < n; i++) s += String(o[i]) + ","; return s; }
function readDown(o: any, n: any): any { let s = ""; for (let i = n; i-- > 0;) s += String(o[i]); return s; }
function readHalves(o: any, n: any): any { let s = ""; for (let i = 0; i < n; i += 0.5) s += String(o[i]); return s; }
function fill(o: any, n: any, v: any): any { for (let i = 0; i < n; i++) o[i] = v; }
function addAll(o: any, n: any, v: any): any { for (let i = 0; i < n; i++) o[i] += v; }
function copy(a: any, b: any, n: any): any { for (let i = 0; i < n; i++) a[i] = b[i]; }
function total(o: any, n: any): any { let s: any = 0; for (let i = 0; i < n; i++) s = s + o[i]; return s; }
function bits(o: any, n: any): any { let s: any = 0; for (let i = 0; i < n; i++) s = (s << 1) ^ o[i]; return s; }
function most(o: any, n: any): any { let s: any = o[0]; for (let i = 0; i < n; i++) if (o[i] > s) s = o[i]; return s; }
function rows(list: any, n: any): any { let s = ""; for (let r = 0; r < n; r++) for (let i = 0; i < n; i++) s += String(list[r][i]); return s; }
for (const K of kinds) {
  const isBig = K === BigInt64Array || K === BigUint64Array;
  const of = (...n: number[]): any => K.from(n.map(x => (isBig ? BigInt(x) : x)));
  const start = hash;
  for (const k of keys) {
    attempt(() => read(of(1, 2, 3, 4), k)); attempt(() => step(of(1, 2, 3, 4), k)); attempt(() => has(of(1, 2, 3, 4), k));
    for (const v of values) {
      const a = of(1, 2, 3, 4), b = of(5, 6, 7, 8);
      attempt(() => write(a, k, v)); attempt(() => readAll(a, 5)); attempt(() => writeStrict(b, k, v)); attempt(() => readDown(b, 5)); attempt(() => add(b, k, v)); attempt(() => either(b, k, v)); attempt(() => read(b, k)); attempt(() => Object.keys(b).join());
    }
  }
  for (const v of values) { const a = of(1, 2, 3, 4); attempt(() => fill(a, 6, v)); attempt(() => readAll(a, 6)); attempt(() => addAll(a, 3, v)); attempt(() => total(a, 4)); attempt(() => bits(a, 4)); attempt(() => most(a, 5)); attempt(() => readHalves(a, 5)); }
  for (const L of kinds) { const a = of(1, 2, 3), b: any = L === BigInt64Array || L === BigUint64Array ? L.from([7n, 8n, 9n]) : L.from([7.5, 300, -2]); attempt(() => copy(a, b, 4)); attempt(() => readAll(a, 4)); attempt(() => rows([a, b, a, b], 4)); attempt(() => rows([b, a, [1, 2], "abcd"], 4)); attempt(() => total(b, 3)); }
  console.log(K.name, (hash - start) | 0);
}
console.log(count, hash);
