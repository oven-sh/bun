"use strict";
// STATISTIC: ArrayOrUint8ArrayLoopsVersioned >= 3
// Where a turn calls what is no built-in by the text, the call is the turn's price: the front keeps the list of numbers and the views and has no copy for a list of anything. `Math.max(..)` is no such call.
const key = JSON.parse('"go"');
const pushed = { go(d) { const o = []; for (let i = 0; i < d.length; i++) o.push(d[i] & 15); return o.join(); } };
const weighed = { go(d, w) { let s = 0; for (let i = 0; i < d.length; i++) s += w(d[i] * 2); return s; } };
const capped = { go(d) { let s = 0; for (let i = 0; i < d.length; i++) s += Math.min(d[i] * 2, 9); return s; } };
const boxed = () => { const d = JSON.parse('["x",1,2,1.5,-0,3]'); d[0] = 4; return d; };
const shrinks = d => x => { if (x > 5) d.length = 1; return x; };
const given = () => [boxed(), [1, 2, 3], [0.5, 1.5], [], [1, "two", , { valueOf() { return 3; } }], new Uint8Array([1, 250]), Buffer.from([7, 8]), new Float64Array([0.5]), new Int16Array([-4]), "12", { length: 1, 0: 6 }];
for (const d of given()) for (let turn = 0; turn < 3; turn++) { let said; try { said = pushed[key](d) + " " + weighed[key](d, x => x + 1) + " " + capped[key](d); } catch (e) { said = e.name; } console.log(said); }
for (let turn = 0; turn < 3; turn++) { const d = boxed(); console.log(weighed[key](d, shrinks(d)), d.length); }
