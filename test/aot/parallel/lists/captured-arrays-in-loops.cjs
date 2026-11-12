// A closure that reads a captured array is called in a loop that reads the array itself.
const say = (...a) => console.log(a.join(" "));
class Bytes extends Uint8Array {} class List extends Array {}
const list = [1, 2, 3, 250, 77, 9], holes = list.slice(); delete holes[2];
const above = list.slice(); delete above[1]; Object.setPrototypeOf(above, Object.assign(Object.create(Array.prototype), { 1: 66 }));
const gone = new Uint8Array(list); gone.buffer.transfer();
const kinds = {
  list, doubles: list.map(x => x + 0.5), mixed: [1, "4", 3, null, true, undefined], holes, above, frozen: Object.freeze(list.slice()), heir: List.from(list), bytes: new Uint8Array(list), buffer: Buffer.from(list), subclass: new Bytes(list),
  clamped: new Uint8ClampedArray(list), int8: new Int8Array(list), int16: new Int16Array(list), uint16: new Uint16Array(list.map(x => x * 257)), int32: new Int32Array(list.map(x => -x * 65537)), uint32: new Uint32Array(list.map(x => x * 16843009)),
  float32: new Float32Array([1.5, NaN, -0, 1e10]), float64: new Float64Array(list.map(x => x + 0.25)), gone, record: { length: 3, 0: 5, 1: 6, 2: 7 }, text: "0123", args: (function () { return arguments; })(4, 5, 6), proxy: new Proxy(list, {}), seven: 7, big: new BigInt64Array(2), none: undefined, nil: null,
  part: new Uint8Array(list).subarray(2, 5), shared: new Uint8Array(new SharedArrayBuffer(4)), growable: new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })),
};
function hashes(dat, mask) { let h = 0; const hsh = i => (dat[i] ^ (dat[i + 1] << 2)) & mask; for (let i = 0; i + 1 < dat.length; i++) { h = (h * 31 + hsh(i)) | 0; if (hsh(i) === 3) h += dat[i]; } return h; }
function sums(dat) { let t = 0; const at = function (i) { return dat[i]; }; for (let i = 0; i < dat.length; i++) t += at(i) * 2 - dat[i] / 2; return t; }
function alone(dat) { let t = 0; const at = i => dat[i] & 255; for (let i = 0; i < dat.length; i++) t = (t + at(i)) | 0; return t; }
function two(a, b) { let t = 0; const ab = i => a[i] + b[i], ba = i => b[i] - a[i]; for (let i = 0; i < a.length; i++) t = (t + ab(i) * ba(i) + a[i] - b[i]) | 0; return t; }
function stores(dat) { let t = 0; const put = (i, v) => { dat[i] = v; return dat[i]; }; for (let i = 0; i < dat.length; i++) t = (t + put(i, (dat[i] + 1) & 127)) | 0; return t; }
function reassigned(dat, other) { let t = 0; const at = i => dat[i] & 1023; for (let i = 0; i < 6; i++) { t = (t + at(i) + (dat[i] & 7)) | 0; if (i === 3) dat = other; } return t; }
function nested(dat) { let t = 0; const at = i => dat[i] & 63; const pair = i => at(i) ^ at(i + 1); for (let i = 0; i < dat.length; i++) for (let j = 0; j < 2; j++) t = (t * 3 + pair(i + j) + dat[j]) | 0; return t; }
function leaves(dat) { const out = []; let t = 0; const at = i => dat[i] & 15; for (let i = 0; i < dat.length; i++) { t = (t + at(i) + dat[i]) | 0; if (i === 1) out.push(at); } return t + ":" + out.map(f => f(0)).join(); }
function throws(dat) { let t = 0; const at = i => { if (i === 2) throw new Error("at " + (dat[i] & 255)); return dat[i] & 31; }; try { for (let i = 0; i < dat.length; i++) t = (t + at(i) + (dat[i] & 1)) | 0; } catch (e) { return e.message + " " + t; } return t; }
function changes(dat) { let t = 0; const at = i => dat[i] & 255; for (let i = 0; i < 8; i++) { t = (t + at(i) + (dat[i] & 3)) | 0; if (i === 2) { try { if (Array.isArray(dat)) dat[4] = "9"; else if (ArrayBuffer.isView(dat)) dat.buffer.transfer(); } catch {} } } return t; }
const copy = v => Array.isArray(v) ? (Object.isFrozen(v) ? Object.freeze(v.slice()) : Object.getPrototypeOf(v) === Array.prototype ? v.slice() : v) : ArrayBuffer.isView(v) && v.length && !(v.buffer instanceof SharedArrayBuffer) ? v.slice() : v;
const attempt = (f, ...a) => { try { return String(f(...a)); } catch (e) { return e.constructor.name; } };
for (let turn = 0; turn < 3; turn++) for (const [name, f] of Object.entries({ hashes: d => hashes(d, 1023), sums, alone, nested, leaves, throws, stores: d => stores(copy(d)), changes: d => changes(copy(d)) })) say(name, Object.entries(kinds).map(([k, v]) => k + "=" + attempt(f, v)).join(" "));
const some = ["list", "doubles", "holes", "bytes", "buffer", "int32", "float64", "text", "mixed"];
for (let turn = 0; turn < 2; turn++) for (const a of some) say(a, some.map(b => b + "=" + attempt(two, kinds[a], kinds[b]) + "/" + attempt(reassigned, kinds[a], kinds[b])).join(" "), attempt(two, kinds[a], kinds[a]));
