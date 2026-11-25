"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
for (const one of all) {
  if (one.kept & 1) Object.defineProperty(one, "tag", { value: 7 });
  else Object.defineProperty(one, "tag", { value: 8, writable: true, configurable: true });
}
all[2].tag = 9;
console.log("SAID", sum(all), all[1].tag, all[2].tag, Object.keys(all[3]).join(), process.argv.length > 9 ? 1 : 0);
