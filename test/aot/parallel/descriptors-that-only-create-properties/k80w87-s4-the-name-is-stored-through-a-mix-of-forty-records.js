"use strict";
function make(i) { return { kept: i, other: i * 2 }; }
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].kept + list[i].other; return s; }
const all = []; for (let i = 0; i < 40; i++) all.push(make(i));
const mixed = [{ a0: 0 }, { a1: 1 }, { a2: 2 }, { a3: 3 }, { a4: 4 }, { a5: 5 }, { a6: 6 }, { a7: 7 }, { a8: 8 }, { a9: 9 }, { a10: 10 }, { a11: 11 }, { a12: 12 }, { a13: 13 }, { a14: 14 }, { a15: 15 }, { a16: 16 }, { a17: 17 }, { a18: 18 }, { a19: 19 }, { a20: 20 }, { a21: 21 }, { a22: 22 }, { a23: 23 }, { a24: 24 }, { a25: 25 }, { a26: 26 }, { a27: 27 }, { a28: 28 }, { a29: 29 }, { a30: 30 }, { a31: 31 }, { a32: 32 }, { a33: 33 }, { a34: 34 }, { a35: 35 }, { a36: 36 }, { a37: 37 }, { a38: 38 }, { a39: 39 }];
for (const one of all) mixed.push(one);
function lay(any) { any.tag = 1; }
for (let i = 0; i < 20; i++) Object.defineProperty(all[i], "tag", { value: 7 });
for (let i = 0; i < mixed.length; i++) if (!("tag" in mixed[i])) lay(mixed[i]);
console.log("SAID", sum(all), all[3].tag, all[30].tag, Object.keys(all[3]).join(), Object.keys(all[30]).join(), process.argv.length > 9 ? 1 : 0);
