// A field is filled by a call of a method that gives a view or a list of another class for each word; a field that begins as an empty list gets a view later, and a copy of a field holds what the field holds. Loops over them read and store as if each field held one class, and whatever else comes is taken as written.
'use strict';
class Loom {
  constructor(threads, rows) {
    this.threads = threads; this.rows = rows;
    this.warp = this.room(threads, 'whole'); this.weft = this.room(rows, 'part'); this.knots = this.room(threads * rows, 'byte'); this.edge = this.room(rows, 'short'); this.names = this.room(threads, 'any');
    this.cloth = []; this.copy = null;
  }
  room(n, word, v = 0) {
    switch (word) {
      case 'whole': return new Int32Array(n).fill(v);
      case 'part': return new Float32Array(n).fill(v);
      case 'byte': return new Uint8Array(n).fill(v);
      case 'short': return new Int16Array(n).fill(v);
      default: return new Array(n).fill(word === 'any' ? null : word);
    }
  }
  stretch() { for (let i = 0; i < this.threads; i++) { this.warp[i] = i * 1000003; this.names[i] = 't' + i; } for (let r = 0; r < this.rows; r++) { this.weft[r] = r / 3; this.edge[r] = r * 9999; } return this; }
  weave() { this.cloth = this.room(this.threads * this.rows, 'byte'); for (let r = 0; r < this.rows; r++) for (let i = 0; i < this.threads; i++) { const at = r * this.threads + i; this.knots[at] = this.warp[i] + this.edge[r]; this.cloth[at] = this.knots[at] ^ (this.weft[r] * 255); } this.copy = this.cloth; return this; }
  sum() { let s = 0; for (let i = 0; i < this.cloth.length; i++) s += this.copy[i] * 3 - this.cloth[i]; for (let i = 0; i < this.warp.length; i++) s += this.warp[i]; for (let i = 0; i < this.weft.length; i++) s += this.weft[i]; return s; }
  worn(at) { const was = this.knots[at]; this.knots[at] -= 300; this.edge[at % this.rows]++; this.warp[at % this.threads] += 0.75; return [was, this.knots[at], this.edge[at % this.rows], this.warp[at % this.threads]].join('/'); }
  said() { let out = ''; for (let i = 0; i < this.names.length; i++) out += this.names[i]; return out; }
}
const told = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
const loom = new Loom(5, 4); console.log(loom.cloth.length, loom.sum(), loom.said()); loom.stretch().weave();
for (let k = 0; k < 80; k++) { const l = new Loom(k % 7 + 1, k % 3 + 1).stretch().weave(); l.sum(); l.worn(k % 3); l.said(); }
console.log(loom.sum(), loom.said(), [0, 3, 7, 19, 20, -1].map(at => loom.worn(at)).join(' '), loom.copy === loom.cloth, Object.prototype.toString.call(loom.cloth));
const kinds = { whole: 'whole', part: 'part', byte: 'byte', any: 'any', text: 'wool' };
for (const name of Object.keys(kinds)) { const l = new Loom(4, 3).stretch(); l.warp = l.room(4, kinds[name], 2.5); l.edge = l.room(3, kinds[name], -7); console.log(name, told(() => l.weave().sum()), told(() => l.worn(2))); }
const others = [[1, 2, 3, 4], [0.5, , 'x'], null, undefined, new Float64Array([1e300, -0, NaN, 4]), new BigInt64Array(4), 'abcd', { 0: 7, length: 2 }, new Uint8ClampedArray([300, 5, 6, 7]), new Proxy([9, 8, 7, 6], {}), new DataView(new ArrayBuffer(4))];
for (const field of ['warp', 'weft', 'copy', 'names']) console.log(field, others.map(other => told(() => { const l = new Loom(4, 2).stretch().weave(); l[field] = other; return Math.round(l.sum() * 100) / 100 + l.said().slice(0, 9) + l.worn(1); })).join(' '));
const gone = new Loom(3, 3).stretch().weave(); structuredClone(gone.warp.buffer, { transfer: [gone.warp.buffer] }); console.log(gone.warp.length, told(() => gone.sum()), told(() => gone.worn(0)));
const room = new ArrayBuffer(8, { maxByteLength: 16 }), grown = new Loom(4, 2).stretch().weave(); grown.copy = new Uint8Array(room); console.log(told(() => grown.sum())); room.resize(16); console.log(grown.copy.length, told(() => grown.sum())); room.resize(2); console.log(grown.copy.length, told(() => grown.sum()));
class Wide extends Loom { room(n, word, v) { return word === 'byte' ? new Uint16Array(n) : word === 'whole' ? new Float64Array(n) : super.room(n, word, v); } } const wide = new Wide(5, 4).stretch().weave(); console.log(wide.sum(), wide.worn(7), wide.knots.constructor.name, wide.warp.constructor.name);
delete loom.copy; console.log(told(() => loom.sum())); Object.defineProperty(loom, 'copy', { get() { return loom.knots; }, configurable: true }); console.log(told(() => loom.sum())); Loom.prototype.room = () => [1, 2, 3]; console.log(told(() => new Loom(2, 2).stretch().weave().sum()), told(() => loom.weave().sum()));
