// STATISTIC: WalkLoopsVersioned >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
const said = [];
class Above { constructor(early) { if (early) { try { said.push(this.sum(0)); } catch (e) { said.push(e instanceof TypeError ? 'TypeError' : 'other'); } } } }
class Below extends Above { #rows = [1.5, 2.5, q]; get rows() { return this.#rows; } sum(t) { let s = t & 1; for (let i = 0; i < this.rows.length; i++) s = s + this.rows[i] * 2; return s; } }
const late = new Below(false); for (let t = 0; t < 30; t++) late.sum(t);
said.push(late.sum(0)); const early = new Below(true); said.push(early.sum(1)); console.log(said.join());
