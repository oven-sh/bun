"use strict";
// `do { s += d[pos++]; } while (--n);` in a loop: holders, starts and lengths of every kind.
const out = [];
const say = (...a) => out.push(a.map(x => typeof x === "bigint" ? x + "n" : Object.is(x, -0) ? "-0" : String(x)).join(" "));
const attempt = (f, ...a) => { try { return f(...a); } catch (e) { return e.constructor.name + ": " + e.message; } };
globalThis.__unknown = new Map();
function adler(adler, buf, len, pos) { var s1 = (adler & 0xffff) | 0, s2 = ((adler >>> 16) & 0xffff) | 0, n = 0; while (len !== 0) { n = len > 20 ? 20 : len; len -= n; do { s1 = (s1 + buf[pos++]) | 0; s2 = (s2 + s1) | 0; } while (--n); s1 %= 65521; s2 %= 65521; } return (s1 | (s2 << 16)) + ":" + pos; }
function rows(d, w, h, at) { let t = 0; for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) t += d[at++]; t *= 3; } return t + "/" + at; }
function back(d, w, h, at) { let t = 0; for (let y = 0; y < h; y++) { let k = w; while (k-- > 0) { t = t * 2 + d[at--]; if (t > 1e6) { t -= 1e6; continue; } } } return t + "/" + at; }
function pairs(d, n, at) { let t = 0, u = 0; for (let j = 0; j < n; j++) { for (let k = 0; k < 3; k++) t += d[at++] * k; for (let k = 0; k < 2; k++) u -= d[at++] + t; if (u < -1e9) break; } return t + "," + u + "/" + at; }
function copy(d, s, w, h, from, to) { for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) d[to++] = s[from++]; from += 2; } return Array.prototype.join.call(d, "") + "/" + from + "/" + to; }
function three(d, n, at) { let t = 0; for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) t = (t + d[at++]) | 0; return t + "/" + at; }
function thrown(d, n, at) { let t = 0; try { for (let j = 0; j < n; j++) { let k = 4; do { t += d[at++]; if (at === 13) throw new RangeError("at " + at); } while (--k); } } catch (e) { return t + " " + e.message; } return t + "/" + at; }
function called(d, n, at, f) { let t = 0; for (let j = 0; j < n; j++) { let k = 4; do { t += d[at++]; if (k === 2) f(d, at); } while (--k); } return t + "/" + at; }
for (const [k, f] of Object.entries({ adler, rows, back, pairs, copy, three, thrown, called })) globalThis.__unknown.set(k, f);
const get = k => globalThis.__unknown.get(k);
const N = 70, base = Array.from({ length: N }, (_, i) => (i * 37 + 11) % 251);
class Bytes extends Uint8Array { }
class List extends Array { }
const half = new Float64Array(base.map((x, i) => i % 9 ? x : x + .5)); half[5] = NaN; half[6] = -0; half[7] = Infinity;
const holes = base.slice(); delete holes[4]; holes[9] = undefined; holes[10] = "7"; holes[11] = null;
const frozen = Object.freeze(base.slice()), accessor = base.slice(); Object.defineProperty(accessor, 8, { get() { return 99; } });
const proxy = new Proxy(base.slice(), { get(t, k) { return typeof k === "string" && k === "12" ? 1000 : t[k]; } });
const holders = { list: base.slice(), bytes: new Uint8Array(base), buffer: Buffer.from(base), words: new Uint16Array(base), ints: new Int32Array(base.map(x => x * 1e7)), signed: new Int8Array(base), clamped: new Uint8ClampedArray(base), floats: new Float32Array(base), half, sub: new Bytes(base), List: List.from(base), holes, frozen, accessor, proxy, text: "0123456789".repeat(7), like: { length: N, 3: 4, 4: 5, 12: 6 }, big: new BigInt64Array(N).fill(3n), short: new Uint8Array(9).fill(5), resizable: new Uint8Array(new ArrayBuffer(N, { maxByteLength: 200 })).fill(6) };
let asked = 0; const object = { valueOf() { asked++; return 5; } };
const starts = { zero: 0, three: 3, minus: -2, half: 2.5, nan: NaN, text: "3", nothing: undefined, none: null, yes: true, object, huge: 2 ** 31 - 3, wide: 2 ** 32 - 2, max: 2 ** 53 - 2, negzero: -0 };
for (const [h, d] of Object.entries(holders)) for (const [s, at] of Object.entries(starts)) {
  const a = [attempt(get("adler"), 1, d, 45, at), attempt(get("rows"), d, 5, 4, at), attempt(get("back"), d, 4, 3, at), attempt(get("pairs"), d, 4, at), attempt(get("three"), d, 3, at), attempt(get("thrown"), d, 5, at)];
  say(h, s, ...a, asked);
}
for (const [h, d] of Object.entries({ list: [], bytes: new Uint8Array(40), doubles: new Float64Array(40), words: new Uint16Array(40), frozen: Object.freeze([1]), like: { length: 12 } })) for (const s of ["list", "bytes", "half", "holes", "text", "ints", "short"]) for (const at of [0, 3, 2.5, "1"]) say("copy", h, s, at, attempt(get("copy"), d, holders[s], 4, 3, at, at));
for (const h of ["list", "bytes", "words", "half"]) { const d = holders[h].slice(); let k = 0; say("called", h, attempt(get("called"), d, 6, 2, (x, at) => { if (++k === 2) x[at] = 1000; if (k === 4) x.foo = 1; })); }
{ const r = holders.resizable; let k = 0; say("resized", attempt(get("called"), r, 8, 1, () => { if (++k === 3) r.buffer.resize(16); if (k === 6) r.buffer.resize(60); })); }
{ const b = new Uint8Array(base); let k = 0; say("detached", attempt(get("called"), b, 8, 1, () => { if (++k === 3) structuredClone(b.buffer, { transfer: [b.buffer] }); })); }
{ const l = base.slice(); let k = 0; say("shrunk", attempt(get("called"), l, 8, 1, () => { if (++k === 2) l.length = 14; if (k === 4) l[20] = 1.5; if (k === 5) l.push("x"); })); }
for (let i = 0; i < 60; i++) { get("adler")(1, holders.bytes, 60, i % 5); get("rows")(holders.words, 6, 5, i % 4); }
say(get("adler")(1, holders.bytes, 60, 4), get("rows")(holders.words, 6, 5, 2), get("adler")(1, holders.list, 60, 4), attempt(get("adler"), 1, holders.bytes, 10, 1n), attempt(get("rows"), holders.bytes, 2, 2, Symbol("s")));
console.log(out.join("\n"));
