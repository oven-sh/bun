// STATISTIC: LoopsReversionedForOtherIndexingType >= 1
"use strict";
const OUT = [];
const XS = Array.from({ length: 12 }, (_, i) => i * 3 % 7);
const YS = Array.from({ length: 12 }, (_, i) => (i === 11 ? null : i * 3 % 7));
const ZS = Array.from({ length: 12 }, (_, i) => (i === 3 ? 4294967296 : i * 3 % 7));
const WS = Array.from({ length: 12 }, (_, i) => (i === 0 ? -0 : i * 3 % 7));
let LIST = XS;
function total(t) { let s = t; LIST.forEach(x => { s += x; }); return s; }
function red(t) { return LIST.reduce((a, x) => a + x, t); }
function some() { return LIST.some(x => x > 5) ? 1 : 0; }
function every() { return LIST.every(x => x > -9) ? 1 : 0; }
function find() { return LIST.find(x => x > 1); }
function findIndex() { return LIST.findIndex(x => x > 1); }
for (let t = 0; t < 16; t++) { LIST = (t & 3) === 0 ? XS : (t & 3) === 1 ? YS : (t & 3) === 2 ? ZS : WS; OUT.push(total(t)); OUT.push(red(t)); OUT.push(some()); OUT.push(every()); OUT.push(find()); OUT.push(findIndex()); OUT.push(Object.is(LIST.find(x => x < 1), -0)); }
console.log(OUT.join(" "));
