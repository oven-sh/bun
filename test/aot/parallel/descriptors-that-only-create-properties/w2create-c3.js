"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
function fill(target, source) { return Object.assign(target, source); }
const source = { tag: 5 };
for (const one of all) {
  if (one.kept & 1) Object.defineProperty(one, "tag", { value: 7 });
  else fill(one, source);
}
console.log(sum(all), all[3].tag, all[4].tag, Object.keys(all[3]).join(), Object.keys(all[4]).join(), process.argv[2]);
