// An untyped package and a program of it (round trips): a growable writer and a reader over typed arrays: integers, floats, varints, texts, bits, checksums, base 64 and hex
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const r = x => (x * 1103515245 + 12345) % 2147483648; let seed = 7; for (let i = 0; i < 30; i++) { seed = r(seed); const w = new lib.Writer(i % 4 + 1), vals = [seed & 255, seed & 65535, seed | 0, seed / 7, -seed / 3, BigInt(seed) * (-3n) ** BigInt(i), seed >>> i % 20, (seed % 2000) - 1000, ['', 'abc', 'é€', '😀 x', '\ud800'.slice(0, 0) + 'z'][i % 5]]; w.u8(vals[0]).u16(vals[1], i % 2 === 0).i32(vals[2], i % 3 === 0).f32(vals[3]).f64(vals[4]).i64(vals[5]).varint(vals[6]).zigzag(vals[7]).text(vals[8]).varint(BigInt(vals[6]) << BigInt(i)); const b = w.done(), d = new lib.Reader(b), got = [d.u8(), d.u16(i % 2 === 0), d.i32(i % 3 === 0), d.f32(), d.f64(), d.i64(), d.varint(), d.zigzag(), d.text(), d.big()]; say(i, got.map(String).join(' '), w.grown, b.length, lib.hex(b)); if (i % 10 === 9) try { d.u8(); } catch (e) { say(e.message); } }
