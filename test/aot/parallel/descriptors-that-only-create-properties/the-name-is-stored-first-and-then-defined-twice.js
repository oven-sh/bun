"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
for (const one of all) one.tag = 1;
for (const one of all) Object.defineProperty(one, "tag", { value: 2 });
console.log(sum(all), all[3].tag, Object.keys(all[3]).join());
for (const one of all) Object.defineProperty(one, "tag", { value: 3, enumerable: false });
console.log(sum(all), all[3].tag, Object.keys(all[3]).join());
