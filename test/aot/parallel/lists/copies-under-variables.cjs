// Loops that copy elements under variables of the file that step: d[size++] = s[at++] while size < most, every kind of holder on both sides, traps and accessors that read and store the variables.
// STATISTIC: ElementCopyLoopsHoisted >= 6
const log = []; let effects = 0;
const one = v => typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "bigint" ? v + "n" : typeof v === "string" ? JSON.stringify(v) : v === undefined ? "u" : v === null ? "null" : typeof v === "object" ? "{" + (v.i ?? "") + "}" : String(v);
const show = v => { if (v === null || typeof v !== "object") return one(v); if (v instanceof DataView) return "DataView" + v.byteLength; if (ArrayBuffer.isView(v)) { try { return v.constructor.name + "[" + Array.from(v, one).join() + "]" + Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).reduce((s, b) => (s * 31 + b) | 0, 7); } catch { return v.constructor.name + " gone"; } } if (Array.isArray(v)) { let s = "Array" + v.length + (Object.isFrozen(v) ? "F" : "") + "["; for (let i = 0; i < Math.min(v.length, 60); i++) s += (i in v ? one(v[i]) : "hole") + ","; return s + "]"; } return "{" + Object.keys(v).slice(0, 60).map(k => k + ":" + one(v[k])).join() + "}"; };
class Own extends Int32Array { get first() { return this[0]; } } class Late extends Float64Array { constructor(a) { super(a); this.tag = 1; } } class Kept extends Array { get last() { return this[this.length - 1]; } }
class Short extends Uint8Array { get length() { effects++; return 5; } }
const N = Array.from({ length: 24 }, (_, i) => i * 7 - 20);
const other = new ArrayBuffer(512); const bits = [NaN, -NaN, 0 / 0, -0, 1.5, 2147483647, 2147483648, Infinity];
const kinds = {
  list: () => N.slice(), literal: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], doubles: () => N.map(x => x + 0.5), whole: () => N.map(x => x * 2 ** 31), mixed: () => N.map((x, i) => i % 5 === 3 ? "s" + i : i % 7 === 4 ? null : x), objects: () => N.map(i => ({ i })), late: () => { const a = N.slice(); a[15] = "x"; return a; }, lateDouble: () => { const a = N.slice(); a[9] = -0; a[14] = 1e300; return a; },
  holes: () => [1, 2, 3, 4, , 6, 7, 8, , 10, 11, 12, 13, 14], holey: () => new Array(24), dholes: () => { const a = N.map(x => x + 0.25); delete a[6]; return a; }, nan: () => N.map((x, i) => i === 8 ? NaN : x + 0.5), empty: () => [], room: () => { const a = N.slice(); a.length = 3; return a; }, short: () => [1, 2, 3],
  i8: () => new Int8Array(N), u8: () => new Uint8Array(N), u8c: () => new Uint8ClampedArray(N.map(x => x * 3 + 0.5)), i16: () => new Int16Array(N.map(x => x * 300)), u16: () => new Uint16Array(N.map(x => x * 300)), i32: () => new Int32Array(N.map(x => x * 9999999)), u32: () => new Uint32Array(N.map(x => x * 99999999)), f32: () => new Float32Array(N.map(x => x / 3)), f64: () => new Float64Array(N.map(x => x / 3)), f64n: () => Float64Array.from(N, (x, i) => bits[i & 7]), f32n: () => Float32Array.from(N, (x, i) => i % 3 ? x / 7 : NaN), b64: () => new BigInt64Array(N.map(BigInt)),
  buffer: () => Buffer.from(N), own: () => new Own(N), tagged: () => new Late(N), kept: () => Kept.from(N), clipped: () => new Short(24), tiny: () => new Int32Array(5), none: () => new Float32Array(0), part: () => new Int32Array(new ArrayBuffer(128), 8, 12), grown: () => new Uint8Array(new ArrayBuffer(12, { maxByteLength: 64 })), shared: () => new Int32Array(new SharedArrayBuffer(96)),
  bufA: () => new Uint8Array(other, 0, 40), bufB: () => new Uint8Array(other, 3, 40), bufC: () => new Int32Array(other, 4, 20), bufD: () => new Float64Array(other, 8, 12), bufE: () => new Int32Array(other, 8, 20),
  detached: () => { const v = new Int32Array(N); structuredClone(v, { transfer: [v.buffer] }); return v; }, ownLength: () => { const v = new Uint8Array(N); Object.defineProperty(v, "length", { value: 4 }); return v; },
  text: () => "abcdefghijklmnopqrstuvwx", object: () => ({ 0: 5, 1: 6, 2: 7, length: 3 }), args: () => (function () { return arguments; })(...N), proxy: () => new Proxy(N.slice(), { get(t, k) { effects++; sees(); return t[k]; }, set(t, k, v) { effects += 3; sees(); t[k] = v; return true; } }), view: () => new DataView(new ArrayBuffer(16)),
  nothing: () => undefined, null: () => null, number: () => 5, frozen: () => Object.freeze(N.slice()), frozenLiteral: () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]), sealed: () => Object.seal(N.slice()), fixed: () => Object.preventExtensions(N.slice(0, 9)), accessor: () => { const a = N.slice(); Object.defineProperty(a, 9, { get() { effects++; sees(); return 90; }, set(v) { effects += v | 0; sees(); }, configurable: true }); return a; }, readonly: () => { const a = N.slice(); Object.defineProperty(a, 10, { value: 5, writable: false }); return a; }, inherits: () => { const a = [1, 2, , 4, 5, , 7, 8, 9, 10]; Object.setPrototypeOf(a, Object.create(Array.prototype, { 2: { get() { effects++; return 33; }, set() { effects += 5; } }, 5: { value: 55, writable: false } })); return a; }, behindProxy: () => { const a = [1, 2, , 4, 5, 6, 7, 8]; Object.setPrototypeOf(a, new Proxy(Array.prototype, { get(t, k, r) { effects++; return Reflect.get(t, k, r); }, set(t, k, v, r) { effects += 7; return Reflect.set(t, k, v, r); } })); return a; }
};
let P = 0, Q = 0, M = 12, changes = 0;
function sees() { effects += typeof P === "number" ? P | 0 : 7; if (effects % 7 === 3 && changes++ < 2) P = 1; }
const runs = {
  fills(d, s, n) { for (let i = 0; i < n && P < M;) d[P++] = s[i++]; },
  whiles(d, s, n) { let i = 0; while (P < M && i < n) d[P++] = s[i++]; log.push("i" + i); },
  counts(d, s, n) { for (let i = 0; i < n; i++) d[P++] = s[i]; },
  reads(d, s, n) { for (let i = 0; i < n; i++) d[i] = s[P++]; },
  both(d, s, n) { for (let i = 0; i < n; i++) d[P++] = s[Q++]; },
  before(d, s, n) { for (let i = 0; i < n; i++) d[++P] = s[i]; },
  apart(d, s, n) { for (let i = 0; i < n; i++) { d[P] = s[i]; P++; } },
  adds(d, s, n) { for (let i = 0; i < n; i++) { d[P] = s[i]; P += 1; } },
  values(d, s, n) { const v = s; for (let i = 0; i < n; i++) d[P++] = v; },
  caught(d, s, n) { try { for (let i = 0; i < n; i++) d[P++] = s[i]; } catch (e) { log.push("caught " + e?.constructor?.name + one(P)); } }
};
const starts = [0, 2, 5, -1, 0.5, "1", undefined, 2147483645];
let place = 0;
for (const [name, run] of Object.entries(runs)) for (const t in kinds) { place++; const names = Object.keys(kinds); for (const u of [t, names[place * 7 % names.length], names[place * 13 % names.length]]) { new Uint8Array(other).forEach((_, i, v) => v[i] = i * 37); effects = 0; changes = 0; let d, s; try { d = kinds[t](); s = kinds[u](); } catch (e) { continue; } if (place % 4 === 0) s = d; P = starts[place % 11 % 8]; Q = 1; M = place % 5 ? 12 : 20; let said; try { said = one(run(d, s, 14)); } catch (e) { said = "threw " + e?.constructor?.name; } log.push([name, t, u, said, show(d), show(s), effects, one(P), one(Q)].join(" ")); } }
console.log(log.join("\n"));
