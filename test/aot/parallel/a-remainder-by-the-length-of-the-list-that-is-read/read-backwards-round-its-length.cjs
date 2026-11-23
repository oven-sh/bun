// The key is taken round the length of the list that is read, from its end: the element that stands as far from the end as the turn says.
"use strict";
const show = v => (v === undefined ? "_" : Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "o" : String(v));
function fromEnd(list, turns) { let out = ""; for (let i = 0; i < turns; i++) out += show(list[list.length - 1 - i % list.length]) + " "; return out; }
function before(list, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += list[(i + list.length - 1) % list.length] * (i + 1); return sum; }
function pairs(list, turns) { let out = 0; for (let i = turns - 1; i >= 0; i--) { const last = list[(list.length - 1 - i % list.length) % list.length]; out = (out * 3 + (last | 0)) | 0; } return out; }
function stepsOfTwo(list, turns) { let best = -Infinity; for (let i = 0; i < turns; i += 2) { const v = list[(list.length * 2 - 1 - i) % list.length]; if (v > best) best = v; } return best; }
const lists = [[1, 2, 3], [5], [0.5, -0, 2.25, 8], [], ["a", "b"], [1, , 3], [null, undefined, true], new Int32Array([4, 5, 6, 7]), new Float64Array([0.1, 0.2]), Object.assign([1, 2], { name: 3 }), [{ valueOf: () => 4 }, 2]];
for (const list of lists) for (const turns of [0, 1, 5, 12]) console.log(fromEnd(list, turns), show(before(list, turns)), pairs(list, turns), show(stepsOfTwo(list, turns)));
for (let k = 0; k < 100; k++) { before([k, k + 1, k + 2], 9); pairs([k, 2], 7); stepsOfTwo([k, 3, 1], 8); }
// The list grows, shrinks or is another one while the loop goes round it.
function grows(list, turns) { let out = ""; for (let i = 0; i < turns; i++) { out += show(list[list.length - 1 - i % list.length]); if (i === 2) list.push("n"); if (i === 5) list.length = 2; if (i === 8) list.length = 0; } return out; }
console.log(grows([1, 2, 3, 4], 11), grows([1], 11)); let asked = 0; const odd = { get length() { return ++asked % 3 ? 3 : 2; }, 0: "x", 1: "y", 2: "z" }; console.log(fromEnd(odd, 6), asked);
for (const bad of [null, undefined]) { try { fromEnd(bad, 1); } catch (error) { console.log(error.constructor.name); } } console.log(fromEnd("text", 6), before(new Proxy([1, 2, 3], {}), 5));
