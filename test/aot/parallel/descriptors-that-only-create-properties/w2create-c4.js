"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
function mark(one, key, value) { one[key] = value; }
const first = Symbol.for(process.argv[2] || "a"), second = Symbol.for("b" + (process.argv[3] || ""));
for (const one of all) { mark(one, one.kept & 1 ? first : second, one.kept); Object.defineProperty(one, "tag", { value: 7 }); }
console.log(sum(all), all[3].tag, all[3][first], Object.getOwnPropertySymbols(all[4]).length);
