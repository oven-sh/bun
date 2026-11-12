"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
for (const one of all) {
  if (one.kept & 1) one[Symbol.toStringTag] = "Stored";
  Object.defineProperty(one, Symbol.toStringTag, { value: "Made" });
}
console.log("SAID", sum(all), String(all[1]), String(all[2]), Object.getOwnPropertyDescriptor(all[1], Symbol.toStringTag).enumerable, process.argv.length > 9 ? 1 : 0);
