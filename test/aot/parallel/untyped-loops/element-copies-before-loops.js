// Loops that copy elements between two unknown holders: arrays, views of every kind, one array or views of one buffer on both sides, holes, accessors, proxies, frozen and sealed arrays, strings, nothing.
// STATISTIC: ElementCopyLoopsHoisted >= 10
// STATISTIC: ElementFillLoopsHoisted >= 1
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
  text: () => "abcdefghijklmnopqrstuvwx", object: () => ({ 0: 5, 1: 6, 2: 7, length: 3 }), args: () => (function () { return arguments; })(...N), proxy: () => new Proxy(N.slice(), { get(t, k) { effects++; return t[k]; }, set(t, k, v) { effects += 3; t[k] = v; return true; } }), view: () => new DataView(new ArrayBuffer(16)),
  nothing: () => undefined, null: () => null, number: () => 5, frozen: () => Object.freeze(N.slice()), frozenLiteral: () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]), sealed: () => Object.seal(N.slice()), fixed: () => Object.preventExtensions(N.slice(0, 9)), accessor: () => { const a = N.slice(); Object.defineProperty(a, 9, { get() { effects++; return 90; }, set(v) { effects += v | 0; }, configurable: true }); return a; }, readonly: () => { const a = N.slice(); Object.defineProperty(a, 10, { value: 5, writable: false }); return a; }, inherits: () => { const a = [1, 2, , 4, 5, , 7, 8, 9, 10]; Object.setPrototypeOf(a, Object.create(Array.prototype, { 2: { get() { effects++; return 33; }, set() { effects += 5; } }, 5: { value: 55, writable: false } })); return a; }, behindProxy: () => { const a = [1, 2, , 4, 5, 6, 7, 8]; Object.setPrototypeOf(a, new Proxy(Array.prototype, { get(t, k, r) { effects++; return Reflect.get(t, k, r); }, set(t, k, v, r) { effects += 7; return Reflect.set(t, k, v, r); } })); return a; }
};
const runs = {
  plain(m, d, s, n) { for (let i = 0; i < n; i++) d[i] = s[i]; },
  offsets(m, d, s, n, a, b) { for (let i = 0; i < n; i++) d[i + a] = s[b + i]; },
  fields(m, d, s, n) { for (let i = 0; i < n; i++) m.d[i] = m.s[i]; },
  lengths(m, d, s) { for (let i = 0; i < s.length; i++) d[i] = s[i]; },
  lengthsOfFields(m) { for (let i = 0; i < m.d.length; i++) m.d[i] = m.s[i]; },
  bothBounds(m, d, s, n) { for (let i = 0; i < n && i < s.length; i++) d[i] = s[i]; },
  inclusive(m, d, s, n) { for (let i = 1; i <= n; i++) d[i - 1] = s[i]; },
  shiftsUp(m, d, s, n) { for (let i = 0; i < n; i++) s[i + 1] = s[i]; },
  shiftsDown(m, d, s, n) { for (let i = 0; i < n; i++) s[i] = s[i + 1]; },
  named(m, d, s, n) { for (let i = 0; i < n; i++) { const v = s[i]; d[i] = v; } },
  two(m, d, s, n, a) { let j = a; for (let i = 0; i < n; i++, j++) d[j] = s[i]; return j; },
  steps(m, d, s, n, a) { let i = 0, j = a; while (i < n) d[j++] = s[i++]; return i + "," + j; },
  nested(m, d, s, n) { for (let k = 0; k < 3; k++) for (let i = k; i < n; i++) d[i - k] = s[i]; },
  caught(m, d, s, n) { try { for (let i = 0; i < n; i++) d[i] = s[i]; } catch (e) { return "caught " + e?.constructor?.name; } },
  counts(m, d, s, n) { var i; for (i = 0; i < n; i++) d[i] = s[i]; return i; },
  starts(m, d, s, n, a) { for (let i = a; i < n; i++) d[i] = s[i]; },
  down(m, d, s, n) { for (let i = n - 1; i >= 0; i--) d[i] = s[i]; },
  inserts(m, d, s, n, a) { for (let i = n; i > a; i--) s[i] = s[i - 1]; },
  whileDown(m, d, s, n) { let i = n | 0; while (i--) d[i] = s[i]; return i; },
  pushes(m, d, s, n) { const out = [1]; for (let i = 0; i < n; i++) out.push(s[i]); return out; },
  intoNew(m, d, s, n) { const out = new Array(6), view = new Int16Array(9); for (let i = 0; i < n; i++) out[i] = s[i]; for (let i = 0; i < 9; i++) view[i] = s[i]; return [show(out), show(view)]; },
  fills(m, d, s, n, a) { for (let i = 0; i < n; i++) d[i] = a; },
  fillsElement(m, d, s, n) { const v = s?.[2]; for (let i = 0; i < n; i++) d[i + 1] = v; },
  idle(m, d, s, n, a) { const x = { valueOf() { effects++; return 1; } }; for (let i = 0; i < n; i++) { x - a; d[i] = s[i]; } },
};
let D, S; runs.variables = (m, d, s, n) => { D = d; S = s; return variables(n); };
function variables(n) { for (let i = 0; i < n; i++) D[i] = S[i]; return D?.length; }
const names = ["list", "literal", "doubles", "whole", "mixed", "objects", "late", "lateDouble", "holes", "holey", "dholes", "nan", "empty", "room", "short", "i8", "u8", "u8c", "i16", "u16", "i32", "u32", "f32", "f64", "f64n", "f32n", "b64", "buffer", "own", "tagged", "kept", "clipped", "tiny", "none", "part", "grown", "shared", "bufA", "bufB", "bufC", "bufD", "bufE", "detached", "ownLength"], odd = ["text", "object", "args", "proxy", "view", "nothing", "null", "number", "frozen", "frozenLiteral", "sealed", "fixed", "accessor", "readonly", "inherits", "behindProxy"];
const pairs = []; names.forEach((t, k) => pairs.push([t, names[(k * 7 + 3) % names.length], 0], [t, t, k % 3 === 0 ? 1 : 0], [k % 2 ? "list" : "f64", t, 0], [t, k % 2 ? "doubles" : "empty", 0])); odd.forEach((t, k) => pairs.push([t, names[(k * 5) % names.length], 0], [names[(k * 11) % names.length], t, 0], [t, t, 1]));
let sum = 0; const lines = [];
for (const run of Object.keys(runs)) { let hash = 0; for (const [t, u, same] of pairs) for (const [n, a, b] of [[18, 2, 1], [6, 0, 3], [12, -1, 5], ["12", "1", 2]]) { new Uint8Array(other).forEach((_, i, v) => v[i] = i * 37); effects = 0; const d = kinds[t](), s = same ? d : kinds[u](), m = JSON.parse('{"n":9,"d":0,"s":0}'); m.d = d; m.s = s; let said; try { said = show(runs[run](m, d, s, n, a, b)); } catch (e) { said = "threw " + e?.constructor?.name; } const line = [said, show(d), show(s), effects].join(" "); for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (process.argv[2] === "all") console.log(run, t, u, same, n, a, b, line); } lines.push(run + " " + hash); }
console.log(lines.join("\n"));
