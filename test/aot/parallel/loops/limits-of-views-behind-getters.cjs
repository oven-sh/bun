'use strict';
// A class reads a view through a getter of its own: what the getter gives is seen by the loops that call through it, also where one operand comes through it a second time.
class Block {
  constructor(size) { this.bytes = new DataView(new ArrayBuffer(size)); this.size = size; }
  get view() { return this.bytes; }
  get length() { return this.view.byteLength; }
  fill(seed) { for (let i = 0; i + 4 <= this.length; i += 4) this.view.setInt32(i, seed + i * 3); return this; }
  sum() { let s = 0; for (let i = 0; i + 4 <= this.length; i += 4) s = s + this.view.getInt32(i) | 0; return s; }
  pairs() { let s = 0; for (let i = 0; i + 8 <= this.length; i += 4) s += this.view.getInt16(i) * this.view.getUint8(i + 5); return s; }
  mix(other) { let s = 0; for (let i = 0; i < this.length; i++) s = s * 3 + (this.view.getUint8(i) ^ other.view.getUint8(i)) | 0; return s; }
}
const lay = (block, name, v) => { Reflect.set(block, JSON.parse(name), v); return block; };
const say = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const a = new Block(64).fill(7), b = new Block(64).fill(-9), short = new Block(20).fill(1);
for (let i = 0; i < 60; i++) { a.sum(); b.pairs(); a.mix(b); }
console.log(a.sum(), b.pairs(), a.mix(b), b.mix(a), short.sum(), say(() => a.mix(short)), short.mix(a));
lay(short, '"bytes"', new DataView(new ArrayBuffer(9), 1)); console.log(short.length, short.sum(), say(() => short.pairs()));
lay(a, '"bytes"', { byteLength: 12, getInt32: i => i, getInt16: i => -i, getUint8: () => 3 }); console.log(a.sum(), a.pairs(), a.mix(b));
Object.defineProperty(b, JSON.parse('"view"'), { get() { return new DataView(new ArrayBuffer(8)); } }); console.log(b.sum(), b.pairs(), say(() => b.mix(new Block(8).fill(3))));
const gone = new Block(16).fill(5); structuredClone(gone.bytes.buffer, { transfer: [gone.bytes.buffer] }); console.log(say(() => gone.sum()), say(() => gone.mix(a)));
const none = new Block(8); lay(none, '"bytes"', null); console.log(say(() => none.sum()));
