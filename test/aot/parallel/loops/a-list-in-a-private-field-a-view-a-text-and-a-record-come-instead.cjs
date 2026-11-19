// STATISTIC: WalkLoopsVersioned >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
class Box { #rows; constructor(rows) { this.#rows = rows; } sum() { let s = 0; for (let i = 0; i < this.#rows.length; i++) s = s + this.#rows[i]; return s; } }
const boxes = [new Box(new Float64Array([1.5, -0, q])), new Box('12' + q), new Box(JSON.parse('{"0":1,"1":"x","2":' + q + ',"length":3}')), new Box(new Uint8Array([250, 5, q])), new Box(JSON.parse('[1,2.5,' + q + ']'))];
let last; for (let t = 0; t < 40; t++) last = boxes.map(box => box.sum()).join(); console.log(last);
