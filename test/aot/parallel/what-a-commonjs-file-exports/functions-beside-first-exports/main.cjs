// A module that requires others first and is required at the first call of a function: its exports variable holds the first exports object and the function. A record is never called, so what is no function throws.
// STATISTIC: CallsInlined >= 36
"use strict";
let add, box, late, kept;
function getAdd() { return add || (add = require("./modules/add.cjs")); }
function getBox() { return box || (box = require("./modules/box.cjs")); }
function getLate() { return late || (late = require("./modules/late.cjs")); }
const say = f => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
function sums(n) { let s = 0; const o = { n: 3 }; for (let i = 0; i < n; i++) s += getAdd()(o, i); return s; }
function boxes(n) { let s = 0; for (let i = 0; i < n; i++) s += new (getBox())(i).n; return s; }
function lates(n) { let s = 0; for (let i = 0; i < n; i++) s += getLate()(i); return s; }
console.log(sums(3), sums(300), boxes(3), boxes(300));
console.log(say(() => lates(3)), say(() => lates(300)), say(() => new (getLate())(1)));
console.log(say(() => require("./modules/half.cjs").first), say(() => require("./modules/half.cjs").second));
console.log(say(() => new (getAdd())({ n: 1 }, 2)), say(() => getBox()(1)), [1, 2].map(i => getAdd()({ n: i }, i)).join());
