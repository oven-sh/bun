'use strict';
// A constructor leaves a field null, or fills it with what a call gives that nobody knows; other methods, and another class under the same name, store typed arrays there, which the loops read; in the end something else is stored.
class Reader {
  constructor(make) { this.cells = null; this.size = 0; this.table = make ? make() : undefined; }
  more() { const had = this.cells; this.cells = new Uint8Array(this.size + 16); if (had) this.cells.set(had); }
  push(v) { if (this.size === (this.cells ? this.cells.length : 0)) this.more(); this.cells[this.size++] = v; return this; }
  index() { this.table = new Int32Array(8); for (let i = 0; i < this.size; i++) this.table[this.cells[i] & 7] += i + 1; return this; }
  sum() { let s = 0; for (let i = 0; i < this.size; i++) s = s * 3 + this.cells[i] | 0; return s; }
  most() { let best = 0; for (let i = 1; i < this.table.length; i++) if (this.table[i] > this.table[best]) best = i; return best; }
}
class Wave { constructor() { this.cells = null; this.size = 0; } load(n) { this.cells = new Float32Array(n); this.size = n; for (let i = 0; i < n; i++) this.cells[i] = i / 3; return this; } sum() { let s = 0; for (let i = 0; i < this.size; i++) s += this.cells[i]; return s; } }
const say = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const fill = (r, n) => { for (let i = 0; i < n; i++) r.push(i * 37 + n); return r; };
for (let k = 0; k < 60; k++) { fill(new Reader(), 20).index().most(); fill(new Reader(), 9).sum(); new Wave().load(9).sum(); }
for (const n of [0, 1, 5, 40]) { const r = fill(new Reader(() => [3, 1, 2]), n); console.log(n, r.sum(), r.most(), r.index().most(), r.cells === null ? 'none' : r.cells.length, new Wave().load(n).sum()); }
console.log(say(() => new Reader().most()), new Reader().sum(), new Wave().sum(), say(() => new Reader(() => null).most()), new Reader(() => 'text').most());
const r = fill(new Reader(), 6); r.cells = [1, 2.5, 'x']; console.log(r.sum(), say(() => r.push(9).sum()), r.cells.length); r.cells = new Uint16Array([70000, 5, 6, 7]); r.size = 4; console.log(r.sum(), r.push(99999).sum(), r.index().most());
r.cells = { length: 3, 0: 5, 1: { valueOf() { r.size = 2; return 4; } } }; r.size = 3; console.log(r.sum(), r.size); r.table = Object.freeze([1, 9, 3]); console.log(r.most()); r.cells = null; r.size = 2; console.log(say(() => r.sum()));
const w = new Wave().load(4); structuredClone(w.cells.buffer, { transfer: [w.cells.buffer] }); console.log(w.sum(), w.size); w.cells = fill(new Reader(), 3).cells; console.log(w.sum()); Wave.prototype.load = Reader.prototype.push; console.log(say(() => w.load(3)));
