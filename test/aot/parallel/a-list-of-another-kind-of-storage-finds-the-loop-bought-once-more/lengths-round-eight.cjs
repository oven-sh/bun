// STATISTIC: LoopsBoughtOnceMoreForListsOfAnotherKindOfStorage >= 1
"use strict";
const OUT = [];
const L0 = Array.from({ length: 0 }, (_, i) => i * 3 % 7);
const L1 = Array.from({ length: 1 }, (_, i) => i * 3 % 7);
const L7 = Array.from({ length: 7 }, (_, i) => i * 3 % 7);
const L8 = Array.from({ length: 8 }, (_, i) => i * 3 % 7);
const L9 = Array.from({ length: 9 }, (_, i) => i * 3 % 7);
const L16 = Array.from({ length: 16 }, (_, i) => i * 3 % 7);
const L17 = Array.from({ length: 17 }, (_, i) => i * 3 % 7);
const N1 = Array.from({ length: 1 }, (_, i) => (i === 0 ? null : i * 3 % 7));
const N7 = Array.from({ length: 7 }, (_, i) => (i === 6 ? null : i * 3 % 7));
const N8 = Array.from({ length: 8 }, (_, i) => (i === 7 ? null : i * 3 % 7));
const N9 = Array.from({ length: 9 }, (_, i) => (i === 8 ? null : i * 3 % 7));
const N16 = Array.from({ length: 16 }, (_, i) => (i === 15 ? null : i * 3 % 7));
const N17 = Array.from({ length: 17 }, (_, i) => (i === 16 ? null : i * 3 % 7));
let LIST = L0;
function total(t) { let s = t; LIST.forEach(x => { s += x; }); return s; }
function red(t) { return LIST.reduce((a, x) => a + x, t); }
function some() { return LIST.some(x => x > 5) ? 1 : 0; }
function every() { return LIST.every(x => x > -9) ? 1 : 0; }
function find() { return LIST.find(x => x > 1); }
function findIndex() { return LIST.findIndex(x => x > 1); }
for (let t = 0; t < 26; t++) { const k = t % 13; LIST = k === 0 ? L0 : k === 1 ? L1 : k === 2 ? L7 : k === 3 ? L8 : k === 4 ? L9 : k === 5 ? L16 : k === 6 ? L17 : k === 7 ? N1 : k === 8 ? N7 : k === 9 ? N8 : k === 10 ? N9 : k === 11 ? N16 : N17; OUT.push(total(t)); OUT.push(red(t)); OUT.push(some()); OUT.push(every()); OUT.push(find()); OUT.push(findIndex()); }
console.log(OUT.join(" "));
