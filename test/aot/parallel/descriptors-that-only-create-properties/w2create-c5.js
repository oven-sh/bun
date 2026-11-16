"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
const others = [{ kept: 1, a: 1 }, { kept: 2, b: 1 }, { kept: 3, c: 1 }, { kept: 4, d: 1 }, { kept: 5, e: 1 }, { kept: 6, f: 1 }];
function touch(one) { one.tag = 1; return one.kept; }
let seen = 0; for (const one of others) seen += touch(one);
for (const one of all) {
  if (one.kept & 1) Object.defineProperty(one, "tag", { value: 7 });
  else seen += touch(one);
}
console.log(sum(all), seen, all[3].tag, all[4].tag, others[2].tag, Object.keys(all[4]).join(), process.argv[2]);
