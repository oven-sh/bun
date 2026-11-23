"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
for (const one of all) Object.defineProperty(one, "tag", { value: 7 });
console.log(sum(all));
for (const one of all) Object.defineProperty(one, "kept", { value: 100, writable: false });
let failed = 0; for (const one of all) { try { one.kept = 1; } catch (error) { failed++; } }
console.log(sum(all), failed);
