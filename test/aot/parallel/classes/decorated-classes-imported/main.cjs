// STATISTIC: ConstructsDispatchedByCallee >= 2
const library_1 = require("./library.cjs");
function makePoint(i, next) { const made = new library_1.Point(i, 1); made.next = next; return made; }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let made; for (let k = 0; k < 8; k++) made = makePoint(k, made); for (; made; made = made.next) sum += made.sum(); } return sum; }
const late = x => { const made = new library_1.Late(x); return Object.keys(made).join() + made.sum(); };
console.log(run(100), library_1.own(4), Object.keys(new library_1.Extended(2)).join(), new library_1.Extended(2).sum(), late(5));
library_1.replace();
console.log(late(5), run(10));
try { library_1.Point = null; makePoint(1); } catch (error) { console.log(error.name); }
library_1.Point = library_1.Extended;
console.log(Object.keys(makePoint(1)).join());
