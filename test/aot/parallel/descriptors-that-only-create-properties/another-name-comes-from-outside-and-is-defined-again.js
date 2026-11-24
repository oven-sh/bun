"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
function lay(target, name) { Object.defineProperty(target, name, { value: 5, configurable: true }); }
for (const one of all) Object.defineProperty(one, "tag", { value: 7 });
for (const one of all) lay(one, JSON.parse('"late"'));
for (const one of all) Object.defineProperty(one, "late", { value: 6, enumerable: true });
console.log(sum(all), all[3].tag, all[3].late, Object.keys(all[3]).join());
