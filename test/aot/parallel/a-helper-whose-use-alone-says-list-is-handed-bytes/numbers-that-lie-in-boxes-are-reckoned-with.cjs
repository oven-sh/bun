"use strict";
// STATISTIC: LoopsVersionedForAnyArray >= 3
// A list whose storage holds values and whose elements are all numbers: what JSON gives behind one text that was overwritten, what `[]` and push make in compiled code. The loops only reckon: nothing in their text asks an element what it is. Such a list fails the question for storage of numbers and takes the copy for a list of anything.
const key = JSON.parse('"go"');
const summed = { go(d) { let s = 0; for (let i = 0; i < d.length; i++) s += d[i]; return s; } };
const hashed = { go(d) { let h = 7; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0; return h; } };
const scaled = { go(d) { for (let i = 0; i < d.length; i++) d[i] = d[i] * 2 + 1; return d[0] + d[d.length - 1]; } };
const boxed = () => { const d = JSON.parse('["x",1,2,1.5,-0,3]'); d[0] = 4; return d; };
const pushed = () => { const d = []; d.push({}); d.pop(); for (let i = 0; i < 9; i++) d.push(i / 2); return d; };
const given = () => [boxed(), pushed(), [1, 2, 3], [0.5, 1.5], JSON.parse("[]"), (() => { const d = boxed(); d[2] = "two"; return d; })(), (() => { const d = boxed(); delete d[1]; return d; })(), (() => { const d = boxed(); d[3] = { valueOf() { return 7; } }; return d; })(), (() => { const d = boxed(); d[4] = 5n; return d; })()];
for (const table of [summed, hashed, scaled]) for (const d of given()) for (let turn = 0; turn < 3; turn++) { let said; try { said = String(table[key](d)); } catch (e) { said = e.name; } console.log(said); }
