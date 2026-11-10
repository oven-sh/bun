// An object with a valueOf comes out at times: the turn begins again in the closed copy and the code runs once a turn, not twice.
// STATISTIC: AnswersOfLookupsAskedForNumbers >= 1
"use strict";
class H extends Map { constructor() { super(); this.hits = 0; } look(k) { return this.get(k); } }
class P { constructor() { this.x = 0; } }
const one = new H(), p = new P(), list = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; let ran = 0, thrown = 0, calls = 0;
const far = v => [v][JSON.parse("0")]; const note = far(function (k) { calls++; return 0; });
for (let k = 0; k < 8; k++) one.set(k, k === 3 ? { valueOf() { ran++; return 10; } } : k);
function f(t) { let s = 0; for (let i = 0; i < 16; i++) s = (s + one.look(i & 7)) & 4095; return s; }
let sum = 0; for (let t = 0; t < 300; t++) sum += f(t); console.log(sum, one.hits, p.x, ran, thrown, calls, list.join(""));
