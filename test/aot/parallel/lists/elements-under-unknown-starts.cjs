// Elements under a start that nobody knows plus a counter.
const say = (...a) => console.log(a.join(" "));
class Bytes extends Uint8Array {}
const list = [1, 2, 3, 250, 77, 9, 1, 2, 3], gone = new Uint8Array(list); gone.buffer.transfer(); const holes = list.slice(); delete holes[2];
const kinds = {
  list, doubles: list.map(x => x + 0.5), holes, mixed: [1, "2", 3, null, 1], bytes: new Uint8Array(list), buffer: Buffer.from(list), subclass: new Bytes(list), clamped: new Uint8ClampedArray(list), int8: new Int8Array(list), int16: new Int16Array(list), uint16: new Uint16Array(list), int32: new Int32Array(list), uint32: new Uint32Array(list), float32: new Float32Array([1, 2, NaN, -0, 1, 2]), float64: new Float64Array(list), gone,
  text: "123121", args: (function () { return arguments; })(1, 2, 3), record: { length: 4, 0: 1, 1: 2, 2: 3, "01": 9, "11": 8, "1.5": 7 }, proxy: new Proxy(list, {}), seven: 7, none: undefined, nil: null, part: new Uint8Array(list).subarray(2, 8), growable: new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })), map: new Map(),
};
const starts = { zero: 0, one: 1, six: 6, far: 100, minus: -1, half: 0.5, nan: NaN, big: 2 ** 31 - 1, huge: 2 ** 53, infinite: Infinity, negzero: -0, text: "1", empty: "", space: " ", none: undefined, nil: null, yes: true, object: { valueOf() { return 1; } }, array: [1], sym: Symbol("s"), bigint: 1n };
function isAt(quote, buf, pos) { if (quote === null) return false; const l = quote.length; for (let i = 0; i < l; i++) { if (quote[i] !== buf[pos + i]) return false; } return true; }
function sum(buf, pos, n) { let t = 0; for (let i = 0; i < n; i++) t += buf[pos + i] * 2; return t; }
function xors(buf, pos, n) { let t = 0; for (let i = 0; i < n; i++) t = (t * 3) ^ buf[i + pos]; return t; }
function copy(from, to, pos, n) { for (let i = 0; i < n; i++) to[pos + i] = from[i]; const keys = Object.keys(to); return keys.length > 40 ? keys.length : keys.map(k => k + to[k]).join(); }
function back(buf, pos, n) { let t = 0; for (let i = n; i > 0; i--) t = (t + buf[pos + i] + buf[pos]) | 0; return t; }
function nested(buf, pos) { let t = 0; for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) t = (t * 7 + (buf[pos + j] === buf[i + pos] ? 1 : 2)) | 0; return t; }
function moves(buf, pos, n) { let t = 0; for (let i = 0; i < n; i++) { t = (t * 5 + buf[pos + i]) | 0; if (i === 1) pos = pos + 1; } return t + ":" + String(pos); }
const attempt = (f, ...a) => { try { return String(f(...a)); } catch (e) { return e.constructor.name; } };
const copyOf = v => Array.isArray(v) ? v.slice() : ArrayBuffer.isView(v) && v.length ? v.slice() : v === kinds.record ? { ...v } : v;
for (let turn = 0; turn < 2; turn++) for (const [start, pos] of Object.entries(starts)) for (const [name, f] of Object.entries({ sum: v => sum(v, pos, 3), xors: v => xors(v, pos, 3), back: v => back(v, pos, 2), nested: v => nested(v, pos), moves: v => moves(v, pos, 4), copy: v => copy([5, 6], copyOf(v), pos, 2) })) say(start, name, Object.entries(kinds).map(([k, v]) => k + "=" + attempt(f, v)).join(" "));
const some = ["list", "doubles", "holes", "bytes", "buffer", "int32", "float64", "text", "record", "mixed"];
for (let turn = 0; turn < 2; turn++) for (const a of some) for (const [start, pos] of Object.entries(starts)) say(a, start, some.map(b => b + "=" + attempt(isAt, kinds[a], kinds[b], pos)).join(" "));
say(isAt(null, kinds.bytes, 1), isAt(Buffer.from("\""), Buffer.from("a\"b"), 1), isAt(Buffer.from("\""), Buffer.from("a\"b"), 2), isAt([], null, 0), isAt(new Uint8Array(0), undefined, {}));
