// a growable writer and a reader over typed arrays: integers, floats, varints, texts, bits, checksums, base 64 and hex
'use strict';
class Writer {
  constructor(size = 8) { this.buf = new Uint8Array(size); this.view = new DataView(this.buf.buffer); this.at = 0; this.grown = 0; }
  room(n) { if (this.at + n > this.buf.length) { let size = this.buf.length * 2; while (size < this.at + n) size *= 2; const next = new Uint8Array(size); next.set(this.buf); this.buf = next; this.view = new DataView(next.buffer); this.grown++; } const at = this.at; this.at += n; return at; }
  u8(v) { const at = this.room(1); this.buf[at] = v; return this; }
  u16(v, le) { const at = this.room(2); this.view.setUint16(at, v, le); return this; }
  i32(v, le) { const at = this.room(4); this.view.setInt32(at, v, le); return this; }
  f32(v) { const at = this.room(4); this.view.setFloat32(at, v); return this; }
  f64(v) { const at = this.room(8); this.view.setFloat64(at, v, true); return this; }
  i64(v) { const at = this.room(8); this.view.setBigInt64(at, BigInt.asIntN(64, BigInt(v))); return this; }
  varint(v) { if (typeof v === 'bigint') { v = BigInt.asUintN(64, v); while (v > 127n) { this.u8(Number(v & 127n) | 128); v >>= 7n; } return this.u8(Number(v)); } v = v >>> 0; while (v > 127) { this.u8(v & 127 | 128); v >>>= 7; } return this.u8(v); }
  zigzag(v) { return this.varint((v << 1) ^ (v >> 31)); }
  text(s) { const start = this.room(1); let n = 0; for (const ch of s) { const c = ch.codePointAt(0); if (c < 0x80) { this.u8(c); n++; } else if (c < 0x800) { this.u8(0xc0 | c >> 6).u8(0x80 | c & 63); n += 2; } else if (c < 0x10000) { this.u8(0xe0 | c >> 12).u8(0x80 | c >> 6 & 63).u8(0x80 | c & 63); n += 3; } else { this.u8(0xf0 | c >> 18).u8(0x80 | c >> 12 & 63).u8(0x80 | c >> 6 & 63).u8(0x80 | c & 63); n += 4; } } this.buf[start] = n; return this; }
  bits(list) { let acc = 0, n = 0; for (const [v, w] of list) { for (let i = w - 1; i >= 0; i--) { acc = acc << 1 | v >>> i & 1; if (++n === 8) { this.u8(acc); acc = n = 0; } } } if (n) this.u8(acc << 8 - n); return this; }
  done() { return this.buf.subarray(0, this.at); }
}
class Reader {
  constructor(bytes) { this.buf = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.at = 0; }
  take(n) { if (this.at + n > this.buf.length) throw new RangeError('read past the end: ' + (this.at + n) + ' of ' + this.buf.length); const at = this.at; this.at += n; return at; }
  u8() { return this.buf[this.take(1)]; } u16(le) { return this.view.getUint16(this.take(2), le); } i32(le) { return this.view.getInt32(this.take(4), le); } f32() { return this.view.getFloat32(this.take(4)); } f64() { return this.view.getFloat64(this.take(8), true); } i64() { return this.view.getBigInt64(this.take(8)); }
  varint() { let r = 0, shift = 0, b; do { b = this.u8(); r |= (b & 127) << shift; shift += 7; } while (b & 128); return r >>> 0; }
  big() { let r = 0n, shift = 0n, b; do { b = this.u8(); r |= BigInt(b & 127) << shift; shift += 7n; } while (b & 128); return r; }
  zigzag() { const n = this.varint(); return n >>> 1 ^ -(n & 1); }
  text() { const n = this.u8(), end = this.at + n; let s = ''; while (this.at < end) { const b = this.u8(); if (b < 0x80) s += String.fromCharCode(b); else if (b < 0xe0) s += String.fromCharCode((b & 31) << 6 | this.u8() & 63); else if (b < 0xf0) s += String.fromCharCode((b & 15) << 12 | (this.u8() & 63) << 6 | this.u8() & 63); else s += String.fromCodePoint((b & 7) << 18 | (this.u8() & 63) << 12 | (this.u8() & 63) << 6 | this.u8() & 63); } return s; }
}
const TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? c >>> 1 ^ 0xedb88320 : c >>> 1; t[n] = c; } return t; })();
const crc32 = bytes => { let c = -1; for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8; return (c ^ -1) >>> 0; };
const adler = bytes => { let a = 1, b = 0; for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; } return (b << 16 | a) >>> 0; };
const fnv = bytes => { let h = 0x811c9dc5; for (const x of bytes) { h ^= x; h = Math.imul(h, 0x01000193); } return h >>> 0; };
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const base64 = b => { let s = '', i = 0; for (; i + 2 < b.length; i += 3) s += A[b[i] >> 2] + A[(b[i] & 3) << 4 | b[i + 1] >> 4] + A[(b[i + 1] & 15) << 2 | b[i + 2] >> 6] + A[b[i + 2] & 63]; if (i < b.length) s += A[b[i] >> 2] + (i + 1 < b.length ? A[(b[i] & 3) << 4 | b[i + 1] >> 4] + A[(b[i + 1] & 15) << 2] + '=' : A[(b[i] & 3) << 4] + '=='); return s; };
const unbase64 = s => { s = s.replace(/=+$/, ''); const out = new Uint8Array(s.length * 3 >> 2); let acc = 0, bits = 0, at = 0; for (const c of s) { acc = acc << 6 | A.indexOf(c); bits += 6; if (bits >= 8) { bits -= 8; out[at++] = acc >> bits & 255; } } return out; };
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
module.exports = { Writer, Reader, crc32, adler, fnv, base64, unbase64, hex };
