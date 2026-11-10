"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
for (const one of all) Object.defineProperty(one, "tag", { value: 7, writable: true });
console.log(sum(all), all[3].tag);
for (const one of all) Object.defineProperty(one, "tag", { writable: false });
console.log(sum(all), all[3].tag, Object.getOwnPropertyDescriptor(all[3], "tag").writable, process.argv[2]);
