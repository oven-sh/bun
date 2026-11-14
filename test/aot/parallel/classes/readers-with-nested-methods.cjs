// A reader made in the function that reads with it: its methods call each other in the loop, throw in the middle and hand the reader out.
"use strict";
class Reader {
  constructor(bytes, limit) { this.bytes = bytes; this.offset = 0; this.limit = limit; this.reads = 0; }
  u8() { this.reads++; return this.bytes[this.offset++]; }
  u16() { return this.u8() | this.u8() << 8; }
  u32() { return (this.u16() | this.u16() << 16) >>> 0; }
  checked() { if (this.offset >= this.limit) throw new RangeError("at " + this.offset); return this.u8(); }
  pair() { const first = this.checked(); return first * 256 + this.checked(); }
  get done() { return this.offset >= this.bytes.length; }
  give(to) { to.push(this); return this.u8(); }
  again(f) { const before = this.offset; const value = f(this); return value + (this.offset - before) * 1000; }
}
class Late extends Reader { u8() { return super.u8() ^ 255; } }
function words(bytes) { let sum = 0; const reader = new Reader(bytes, 0); while (!reader.done) { sum += reader.u8(); sum ^= reader.u16(); sum = (sum + reader.u32()) | 0; } return [sum, reader.offset, reader.reads].join(); }
function late(bytes) { let sum = 0; const reader = new Late(bytes, 0); while (!reader.done) sum = (sum * 31 + reader.u32()) | 0; return [sum, reader.offset, reader.reads].join(); }
function limited(bytes, limit) { let sum = 0, caught = ""; const reader = new Reader(bytes, limit); for (let k = 0; k < 40; k++) { try { sum = (sum * 7 + reader.pair()) % 1000003; } catch (error) { caught += error.message + "@" + reader.offset + ";"; reader.limit += 3; if (caught.length > 60) break; } } return [sum, reader.offset, reader.reads, caught].join(); }
function handed(bytes) { const out = []; let sum = 0; const reader = new Reader(bytes, 9); for (let k = 0; k < 12; k++) { sum += reader.give(out); if (k === 5) out[0].offset += 2; if (k === 8) out[1].bytes = bytes.slice().reverse(); } return [sum, out.length, reader.offset, out[3] === reader].join(); }
function entered(bytes) { let sum = 0; const reader = new Reader(bytes, 9); for (let k = 0; k < 10; k++) sum += reader.again(r => k % 3 ? r.u16() : r.again(q => q.u8())); return [sum, reader.offset].join(); }
function replaced(bytes) { let sum = 0; const reader = new Reader(bytes, 9); for (let k = 0; k < 10; k++) { if (k === 4) reader.u8 = function () { return this.offset++ + 0.5; }; if (k === 8) delete reader.u8; sum += reader.u16() + reader.u8(); } return [sum, reader.offset, Object.keys(reader).join("+")].join(); }
const arrays = [new Uint8Array(0), Uint8Array.from({ length: 7 * 40 }, (_, i) => i * 31), Array.from({ length: 90 }, (_, i) => i % 9 ? i : i / 2), Int16Array.from({ length: 70 }, (_, i) => i * 999), [1, , 3, "4", null, 6, 7, {}, 9, 10, 11, 12, 13, 14]];
for (let turn = 0; turn < 3; turn++) for (const bytes of arrays) console.log([words(bytes), late(bytes), limited(bytes, 5 + turn), handed(bytes), entered(bytes), replaced(bytes)].join(" | "));
