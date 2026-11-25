"use strict";
const turns = +(process.argv[2] ?? 50);
const names = Object.create(null);
names.plain = 1;
if (turns < 0) Object.defineProperty(names, "rare", { value: 7 });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += names.plain + (names.rare === undefined ? 10 : names.rare); return s; }
console.log(drive(turns), "rare" in names, Object.getOwnPropertyNames(names).join());
