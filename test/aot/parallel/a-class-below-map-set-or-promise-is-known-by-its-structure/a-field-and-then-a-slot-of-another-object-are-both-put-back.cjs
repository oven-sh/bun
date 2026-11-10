// A turn stores a field of an object of a class below Map and then a slot of an object of a class of the program: both kinds are put back, each once.
// The question that fails behind the two stores is asked of what the element holds: a list of plain values is asked for its kind in front of the loop, and then no turn begins again.
// STATISTIC: StoresPutBackWhereTurnsBeginAgain >= 2
"use strict";
class H extends Map { constructor() { super(); this.n = 1; this.m = 2; } }
class P { constructor() { this.x = 1; this.y = 2; } }
const values = JSON.parse('[1,2,3,4,5,6,7,0.5,9,10,11,"x",13,14,15,16]').map(v => ({ v }));
function f(one, p, list, t) { let s = 0; for (let i = 0; i < 16; i++) { one.n = one.n + 1; p.x = p.x + 1; s = s + values[i].v; } return s; }
const turns = +(process.argv[2] ?? 300); const said = []; let sum = 0;
for (let t = 0; t < turns; t++) { const one = new H(), p = new P(), list = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]; const got = f(one, p, list, t); if (said.length < 4) said.push(String(got)); sum = (sum + one.n * 7 + one.m * 3 + p.x * 11 + p.y * 13 + Math.floor(list.reduce((a, b) => a + b, 0) * 2)) % 1000003; }
console.log(sum, said.join(" | "));
