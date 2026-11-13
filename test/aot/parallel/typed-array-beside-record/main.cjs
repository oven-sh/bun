"use strict";
function Reader(buffer) { this.buf = buffer; this.pos = 0; this.len = buffer.length; }
Reader.create = function create(buffer) { return new Reader(buffer); };
Reader.prototype.byte = function byte() { return this.buf[this.pos++]; };
Reader.prototype.peek = function peek(at) { return this.buf[at]; };
Reader.prototype.lay = function lay(at, value) { this.buf[at] = value; return this.buf[at]; };
Reader.prototype.two = function two() { var value = (this.buf[this.pos] & 127) >>> 0; if (this.buf[this.pos++] < 128) return value; return (value | (this.buf[this.pos++] & 127) << 7) >>> 0; };
function decode(r, length) { if (!(r instanceof Reader)) r = Reader.create(r); var end = length === undefined ? r.len : r.pos + length, sum = 0; while (r.pos < end) sum = sum * 31 + r.two() | 0; return sum; }
const lines = [];
function attempt(label, run) { try { lines.push(label + " " + String(run())); } catch (error) { lines.push(label + " " + error.name); } }
const bytes = new Uint8Array(40).map((_, i) => i * 37);
for (let i = 0; i < 200; i++) decode(bytes);
attempt("decoded", () => decode(bytes) + " " + decode(Reader.create(bytes), 5));
const inner = Reader.create(bytes);
inner[0] = "own";
inner[-1] = "minus";
const transferred = new Uint8Array([1, 2, 3]);
structuredClone(transferred.buffer, { transfer: [transferred.buffer] });
class Counted extends Uint8Array { get length() { return 2; } }
const resizable = new Uint8Array(new ArrayBuffer(2, { maxByteLength: 8 }));
resizable.buffer.resize(6);
resizable[5] = 9;
const bases = { bytes, inner, list: [5, , 7], text: "abc", clamped: new Uint8ClampedArray([300, 1]), words: new Uint16Array([65535]), doubles: new Float64Array([0.5]), big: new BigInt64Array([5n]), record: { 0: "zero", length: 1 }, frozen: Object.freeze([1]), map: new Map([[0, 1]]), proxy: new Proxy([8], { get: (t, k) => typeof k === "string" ? "p" + k : t[k] }), args: (function () { return arguments; })(4, 5), transferred, counted: new Counted(3).fill(6), resizable, empty: new Uint8Array(0), callable: function () {} };
for (const [name, base] of Object.entries(bases)) {
  for (const at of [0, 1, 5, -1, 0.5, "0", "length", 2 ** 32, NaN, -0, null, undefined, true, 1n]) attempt(name + "[" + String(at) + "]", () => typeof Reader.create(base).peek(at) + " " + String(Reader.create(base).peek(at)));
  attempt(name + " byte", () => { const r = Reader.create(base); return String(r.byte()) + r.byte() + r.byte(); });
}
for (const name of ["bytes", "list", "clamped", "words", "doubles", "big", "record", "frozen", "transferred", "resizable", "empty", "inner"]) {
  for (const [at, value] of [[0, 300], [1, "7"], [0, 1.5], [2, -1], [100, 3], [0, { valueOf() { return 4; } }], [0, 2n], [-1, 1], [0.5, 1]]) attempt(name + "[" + at + "] = " + typeof value, () => String(Reader.create(bases[name]).lay(at, value)));
}
attempt("null", () => Reader.prototype.peek.call({ buf: null }, 0));
attempt("undefined", () => Reader.prototype.peek.call({ buf: undefined }, 0));
attempt("number", () => Reader.prototype.peek.call({ buf: 5 }, 0));
attempt("symbol", () => Reader.prototype.peek.call({ buf: Symbol("s") }, "description"));
console.log(lines.join("\n"));
