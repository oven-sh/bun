// a[i] in text made at run time where a is a typed array: of every kind, with every bit pattern that says something, inside and past the end, with indexes that are none, over buffers that are resized, shared, detached and collected; of heirs
// of the kinds, of what inherits from one, of objects that are no typed arrays at the same site.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
class Compiled extends Uint8Array { get sum() { return this[0] + this[1]; } }
const program = { collect: full => globalThis.Bun?.gc?.(full), compiled: new Compiled([7, 8, 9]), read: (a, i) => a[i] };
const text = `
const lines = [], { collect } = program;
const show = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? "o" : v === undefined ? "u" : typeof v === "function" ? "f" : String(v);
const tell = (name, f) => { let r; try { r = show(f()); } catch (e) { r = "!" + (e?.message ?? e); } lines.push(name + " " + r); };
const read = (a, i) => a[i], added = (a, i) => a[i] + 1, joined = (a, i) => "" + show(a[i]), tested = (a, i) => a[i] ? 1 : a[i] === undefined ? 2 : 0, first = a => a[0], fromCaptured = (a => i => a[i]);
const kinds = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array };
if (typeof Float16Array === "function") kinds.Float16Array = Float16Array;
const bytes = []; for (let i = 0; i < 256; i++) bytes.push((i * 73 + (i >> 3)) & 255);
// Not a number in its several forms, infinities, zeros, the edges of the integers.
const special = [0, 0, 0, 0, 0, 0, 0xf0, 0x7f, 0, 0, 0, 0, 0, 0, 0xf0, 0xff, 1, 0, 0, 0, 0, 0, 0xf8, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0x80, 0, 0, 0xc0, 0x7f, 0, 0, 0x80, 0xff, 0, 0, 0, 0x80, 0xff, 0xff, 0xff, 0x7f, 0, 0, 0, 0x80, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];
const indexes = [0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 31, 32, 100, 255, 256, 1e6, 2147483647, 2147483648, 4294967295, 4294967296, -1, -2147483648, .5, 1.5, -0, NaN, Infinity, "0", "1", "01", "-0", "1.5", "x", "length", null, undefined, true, 1n, Symbol.iterator, {}];
for (const [kn, K] of Object.entries(kinds)) for (const [bn, b] of [["bytes", bytes], ["special", special], ["none", []]]) {
  const buffer = new Uint8Array(b).buffer, a = new K(buffer, 0, Math.floor(b.length / K.BYTES_PER_ELEMENT)), captured = fromCaptured(a);
  let s = ""; for (let i = 0; i < a.length + 3; i++) s += show(a[i]) + ","; lines.push(kn + bn + " " + s);
  for (let j = 0; j < indexes.length; j++) { const i = indexes[j]; tell(kn + bn + j, () => read(a, i)); tell(kn + bn + j, () => captured(i)); if (bn === "special") { tell(kn + bn + j, () => added(a, i)); tell(kn + bn + j, () => joined(a, i)); tell(kn + bn + j, () => tested(a, i)); } }
  tell(kn + bn, () => first(a));
  if (b.length) { const part = new K(buffer, 8, 3); tell(kn + "part", () => [read(part, 0), read(part, 1), read(part, 2), read(part, 3)].map(show).join()); }
}
// Buffers that are resized, grown while shared, detached: the same views before and after.
for (const [kn, K] of Object.entries(kinds)) {
  const resizable = new ArrayBuffer(16, { maxByteLength: 64 }), tracking = new K(resizable), fixed = new K(resizable, 0, 1), behind = new K(resizable, 8, 1); new Uint8Array(resizable).set(bytes.slice(0, 16));
  const all = name => { for (const [vn, v] of [["tracking", tracking], ["fixed", fixed], ["behind", behind]]) tell(kn + name + vn, () => { let s = ""; for (let i = 0; i < 10; i++) s += show(read(v, i)) + ","; return s; }); };
  all("new"); resizable.resize(64); all("grown"); resizable.resize(8); all("shrunk"); resizable.resize(0); all("empty"); resizable.resize(32); all("again");
  const shared = new K(new SharedArrayBuffer(16)), growable = new SharedArrayBuffer(8, { maxByteLength: 32 }), g = new K(growable); new Uint8Array(growable).fill(255); tell(kn + "shared", () => [0, 1, 2].map(i => show(read(shared, i))).join()); tell(kn + "growable", () => [0, 1, 4].map(i => show(read(g, i))).join()); growable.grow(32); tell(kn + "grown", () => [0, 1, 4, 40].map(i => show(read(g, i))).join());
  const plain = new ArrayBuffer(32), view = new K(plain); new Uint8Array(plain).fill(1); tell(kn + "attached", () => [0, 1].map(i => show(read(view, i))).join()); const moved = plain.transfer(); tell(kn + "detached", () => [0, 1].map(i => show(read(view, i))).join()); tell(kn + "moved", () => show(read(new K(moved), 1)));
}
// The same sites: lists, strings, arguments, plain objects, what inherits from a typed array, proxies, heirs, views of the program.
class Own extends Float64Array { constructor(...l) { super(...l); this.own = 1; } at0() { return this[0]; } }
const own = new Own([1.5, 2.5]), others = { list: [1, 2, 3], doubles: [1.5, 2.5], holes: [, 1], text: "abc", args: (function () { return arguments; })(4, 5), object: { 0: "zero", 1: "one" }, inherits: Object.create(new Int16Array([3, 4])), proxy: new Proxy(new Uint8Array([5]), {}), own, program: program.compiled, view: new DataView(new ArrayBuffer(4)), fn: () => 1, number: 5, symbol: Symbol("s"), closed: Object.preventExtensions(new Uint8Array([1])), withNames: Object.assign(new Uint8Array([6]), { x: 1 }) };
for (let turn = 0; turn < 3; turn++) { for (const [on, o] of Object.entries(others)) for (const i of [0, 1, 2, -1, "0", "x", 1.5]) { tell(turn + on + String(i), () => read(o, i)); tell(turn + on + String(i), () => joined(o, i)); } collect(turn === 1); }
tell("at0", () => own.at0()); tell("sum", () => program.compiled.sum); tell("by the program", () => program.read(new Int32Array([-5]), 0)); tell("spread", () => [...new Uint16Array([65535, 1])].join());
// Sums over every kind, in loops long enough to see collections.
for (const [kn, K] of Object.entries(kinds)) { if (kn.startsWith("Big")) continue; const a = new K(500); for (let i = 0; i < 500; i++) a[i] = i * 3.25 - 100; let s = 0, garbage; for (let t = 0; t < 8; t++) { for (let i = 0; i < a.length; i++) { s = s * .5 + a[i]; garbage = [s]; } if (t % 4 === 3) collect(false); } lines.push(kn + " " + s); }
return lines.join("\\n");`;
console.log(new Function("program", hidden(text))(program));
