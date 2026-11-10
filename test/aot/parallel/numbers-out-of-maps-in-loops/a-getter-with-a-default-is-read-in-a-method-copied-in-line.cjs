// A method copied in line reads two getters, and one of them has a default behind ??, so it is more than one block. No way through the copies comes to an operation that stays as it is written:
// what the getters hand back is asked for a number, and the sum stays typed.
// STATISTIC: AnswersOfLookupsAskedForNumbers >= 1
"use strict";
class Grid { constructor(options) { this.o = options; } get size() { return this.o.size; } get gap() { return this.o.gap ?? 3; } at(i) { return i * this.size + this.gap; } }
const grid = new Grid(JSON.parse('{"size":4}'));
function f(t) { let s = 0; for (let i = 0; i < 128; i++) s += grid.at(i & 7); return s & 65535; }
let sum = 0; for (let t = 0; t < 300; t++) sum = (sum + f(t)) % 1000003; console.log(sum);
