// Values that code indexes with numbers and asks for subarray(), set(), byteLength or buffer.
const say = (...a) => console.log(a.join(" "));
class Bytes extends Uint8Array {}
const list = [1, 2, 3, 250, 77, 9], gone = new Uint8Array(list); gone.buffer.transfer();
const withMethod = list.slice(); withMethod.subarray = function (a, b) { return this.slice(a, b); }; const holes = withMethod.slice(); delete holes[1]; holes.subarray = withMethod.subarray;
const kinds = {
  list, doubles: list.map(x => x + 0.5), withMethod, holes, record: { length: 4, 0: 1, 1: 2, 2: 3.5, 3: 4, byteLength: 4, byteOffset: 0, subarray(a, b) { return [this[a], this[b]]; } }, bytes: new Uint8Array(list), buffer: Buffer.from(list), subclass: new Bytes(list),
  clamped: new Uint8ClampedArray(list), int8: new Int8Array(list), int16: new Int16Array(list), uint16: new Uint16Array(list.map(x => x * 257)), int32: new Int32Array(list.map(x => -x * 65537)), uint32: new Uint32Array(list.map(x => x * 16843009)),
  float32: new Float32Array([1.5, NaN, -0, 1e10]), float64: new Float64Array(list.map(x => x + 0.25)), gone, text: "0123", args: (function () { return arguments; })(4, 5, 6), proxy: new Proxy(new Uint8Array(list), { get(t, k) { const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } }), seven: 7, big: new BigInt64Array(4), none: undefined, nil: null, map: new Map([[0, 1]]), view: new DataView(new ArrayBuffer(4)),
  part: new Uint8Array(list).subarray(2, 5), shared: new Uint8Array(new SharedArrayBuffer(4)), growable: new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })),
};
const heir = new Uint8Array(list); Object.setPrototypeOf(heir, Object.assign(Object.create(Uint8Array.prototype), { 9: 5 })); kinds.heir = heir; const own = new Uint8Array(list); own.subarray = () => [7, 8]; kinds.own = own;
function crc(d, part) { let c = -1; for (let i = 0; i < d.length; ++i) c = ((c << 1) ^ d[i]) | 0; return part ? c + crc(d.subarray(1, 3), false) : c; }
function adler(d) { let a = 1, b = 0; const l = d.byteLength; for (let i = 0; i < l; i++) { a = (a + d[i]) % 65521; b = (b + a) % 65521; } return (b << 16) | a; }
function from(d, at) { let t = 0; for (let i = at; i < at + 3; i++) t += d[i] * 2; if (t === 0.125) return d.subarray(at).length; return t; }
function copies(d) { const o = new Uint8Array(8); for (let i = 0; i < d.length; i++) o[i] = d[i] + 1; if (o[7] === 250) o.set(d.subarray(0, 1)); return o.join(); }
function both(d, e) { let t = 0; for (let i = 0; i < d.length; i++) t = (t + (d[i] ^ e[i])) | 0; return t + (d.byteOffset === 9 ? e.subarray(1).length : 0); }
function halves(d) { let t = 0; for (let i = 0; i < d.length; i++) t = (t + (d[i] & 15)) | 0; if (d.buffer === undefined) return t + "!"; return t + ":" + d.subarray(1, 2).length; }
function writes(d) { for (let i = 0; i < d.length; i++) d[i] = (d[i] + 3) & 63; return Array.prototype.join.call(d.subarray(0, 4)); }
function matches(d, at) { let n = 0; for (; n < 4 && d[at + n] == d[n]; ++n); if (n > 2) return d.subarray(at, at + n).length; let t = 0; for (let i = 0; i < n + 2; i++) t = (t * 7 + d[i]) | 0; return t; }
const copy = v => Array.isArray(v) ? Object.assign(v.slice(), v.subarray ? { subarray: v.subarray } : {}) : ArrayBuffer.isView(v) && v.length && !(v.buffer instanceof SharedArrayBuffer) && Object.getPrototypeOf(v) !== Object.getPrototypeOf(heir) ? v.slice() : v;
const attempt = (f, ...a) => { try { return String(f(...a)); } catch (e) { return e.constructor.name; } };
for (let turn = 0; turn < 3; turn++) for (const [name, f] of Object.entries({ crc: d => crc(d, true), adler, from: d => from(d, 1), past: d => from(d, 4), copies, both: d => both(d, d), halves, writes: d => writes(copy(d)), matches: d => matches(d, 2), same: d => matches(d, 0) })) say(name, Object.entries(kinds).map(([k, v]) => k + "=" + attempt(f, v)).join(" "));
const some = ["list", "bytes", "buffer", "int32", "float64", "record", "withMethod"]; for (const a of some) say(a, some.map(b => b + "=" + attempt(both, kinds[a], kinds[b])).join(" "));
