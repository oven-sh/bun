// STATISTIC: LoopsBuiltTwice >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
class Box { #rows = JSON.parse('[1,2,3,4,5,6]'); #other = JSON.parse('[10.5,20.5,30.5,' + q + ']'); sum(t) { let s = 0; for (let i = 0; i < this.#rows.length; i++) { s = s + this.#rows[i] * 2; if (t === 30 && i === 1) this.#rows = this.#other; } return s; } }
const box = new Box(); const said = []; for (let t = 0; t < 40; t++) said.push(box.sum(t)); console.log(said[0], said[30], said[31], said[39]);
