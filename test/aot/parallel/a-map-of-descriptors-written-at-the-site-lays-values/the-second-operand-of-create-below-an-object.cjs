"use strict";
const above = { twice(a) { return a * 2 + this.base; } };
const names = Object.create(above, { base: { value: 3 }, add: { value(a, b) { return a + b; }, enumerable: true }, plain: { value: (a) => a + 1 } });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = (names.twice(s) + names.plain(i)) % 1009; return s; }
console.log(drive(+(process.argv[2] ?? 50)), Object.getPrototypeOf(names) === above, Object.keys(names).join());
