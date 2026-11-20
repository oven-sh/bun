// Several reads of one view find its length and its vector in registers, until something runs that may give the view other memory.
// STATISTIC: ViewStorageReused >= 8
class Reader {
  constructor(bytes) { this.bytes = bytes; this.at = 0; }
  u16() { const v = this.bytes[this.at] | this.bytes[this.at + 1] << 8; this.at += 2; return v; }
  u32() { const v = this.bytes[this.at] | this.bytes[this.at + 1] << 8 | this.bytes[this.at + 2] << 16 | this.bytes[this.at + 3] << 24; this.at += 4; return v >>> 0; }
}
function four(v, at) { return [v[at], v[at + 1], v[at + 2], v[at - 1]].join(); }
function around(v, at, change) { const a = v[at] + "," + v[at + 1]; change(v); return a + "," + v[at] + "," + v[at + 1]; }
function swap(v, at) { const a = v[at], b = v[at + 1]; v[at] = b; v[at + 1] = a; return v[at] + "," + v[at + 1] + "," + v[at + 100]; }
function either(v, at) { let s = 0; if (v[at] > 3) s += v[at + 1] | 0; else s -= v[at + 1] | 0; return s + (v[at + 2] | 0); }
const fill = v => { for (let i = 0; i < v.length; ++i) v[i] = i * 13 % 101; return v; };
const views = () => [
  fill(new Uint8Array(12)), fill(new Uint8Array(4000)), fill(new Uint8Array(new ArrayBuffer(12, { maxByteLength: 24 }))), fill(new Uint8Array(new ArrayBuffer(12, { maxByteLength: 24 }), 2, 6)),
  fill(new Uint8Array(new ArrayBuffer(16), 4, 9)), new Uint8Array(0), fill(new Uint8Array(new SharedArrayBuffer(8, { maxByteLength: 16 }))),
];
for (const v of views()) {
  const reader = new Reader(v);
  console.log(reader.u16(), reader.u32(), reader.u32(), reader.u32(), reader.at);
  console.log(four(v, 0), "|", four(v, 3), "|", four(v, 11), "|", four(v, -1), "|", four(v, 4294967295), "|", four(v, 2.5));
  console.log(swap(v, 1), "|", swap(v, 7), "|", either(v, 0), either(v, 5), either(v, 9));
}
for (const change of [() => {}, v => { if (v.buffer.resizable) v.buffer.resize(4); }, v => { if (v.buffer.resizable) v.buffer.resize(v.buffer.maxByteLength); }, v => { if (v.buffer.growable) v.buffer.grow(v.buffer.maxByteLength); }, v => { try { v.buffer.transfer(); } catch { } }, v => { v[2] = 77; }]) {
  for (const v of views()) console.log(around(v, 2, change), "|", around(v, 5, change), v.length);
}
