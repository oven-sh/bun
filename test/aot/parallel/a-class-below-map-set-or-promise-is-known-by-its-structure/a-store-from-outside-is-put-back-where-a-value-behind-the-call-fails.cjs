// A turn stores a field, calls a method that reads it, and adds a value that is no whole number in two of the turns: there the turn begins again as written, and the field holds what it held at the turn's head.
// STATISTIC: StoresPutBackWhereTurnsBeginAgain >= 1
// Under: --aot-testing=CheckEffectsAtRunTime: the store that puts the field back undoes a deed of the turn and is counted so
"use strict";
class H extends Map { constructor() { super(); this.n = 1; this.m = 2; this.o = null; } two() { return this.n + 1; } }
const far = v => [v][JSON.parse("0")];
const values = JSON.parse('[1,2,3,4,5,6,7,0.5,9,10,11,"x",13,14,15,16]');
function f(one, other, t) { let s = 0; for (let i = 0; i < 16; i++) { one.n = one.n + i; s = s + one.two() + values[i]; } return s; }
const turns = +(process.argv[2] ?? 300); const said = []; let sum = 0;
for (let t = 0; t < turns; t++) { const one = new H(), other = new H(); const got = f(one, other, t); if (said.length < 4) said.push(String(got)); sum = (sum + one.n * 7 + one.m * 3 + other.n) % 1000003; }
console.log(sum, said.join(" | "));
