"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
for (const one of all) Object.defineProperty(one, "tag", { value: 7, configurable: true });
for (const one of all) delete one.tag;
console.log(sum(all), "tag" in all[3]);
for (const one of all) Object.defineProperty(one, "tag", { value: 8 });
let failed = 0; for (const one of all) { try { Object.defineProperty(one, "tag", { value: 9 }); } catch (error) { failed++; } }
console.log(sum(all), all[3].tag, failed);
