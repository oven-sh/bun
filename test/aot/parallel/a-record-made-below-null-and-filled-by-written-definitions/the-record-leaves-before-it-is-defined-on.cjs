"use strict";
const kept = [];
const names = Object.create(null);
kept.push(names);
kept[0].early = 1;
Object.defineProperty(names, "early", { value: 2 });
Object.defineProperty(names, "late", { value: 3 });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += names.early + names.late + kept[0].late; return s; }
console.log(drive(+(process.argv[2] ?? 50)), JSON.stringify(Object.getOwnPropertyDescriptor(names, "early")));
