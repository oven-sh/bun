// STATISTIC: LoopsBuiltTwice >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const said = [];
class Base { constructor() { try { said.push(this.sum()); } catch (e) { said.push(e instanceof TypeError ? 'TypeError' : 'other'); } } }
class Box extends Base { #rows = JSON.parse('[1,2.5,' + q + ']'); sum() { let s = 0; for (let i = 0; i < this.#rows.length; i++) s = s + this.#rows[i] * 2; return s; } }
let box; for (let t = 0; t < 40; t++) box = new Box(); console.log(said[0], said[39], box.sum());
