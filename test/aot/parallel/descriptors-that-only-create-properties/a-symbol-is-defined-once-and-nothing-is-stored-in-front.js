"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
function* one() { yield 1; } function* two() { yield 2; } function* three() { yield 3; }
for (const each of all) each[Symbol.iterator] = one;
for (const each of all) Object.defineProperty(each, Symbol.iterator, { value: two });
console.log(sum(all), [...all[3]].join());
console.log(sum(all), [...all[3]].join(), Object.getOwnPropertySymbols(all[3]).length);
