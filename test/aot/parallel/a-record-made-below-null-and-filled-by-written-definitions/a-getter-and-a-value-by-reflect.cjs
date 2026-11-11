"use strict";
let asked = 0;
const names = Object.create(null);
const first = Reflect.defineProperty(names, "size", { get() { return ++asked; } });
const second = Reflect.defineProperty(names, "limit", { value: 100 });
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += names.size + names.limit; return s; }
console.log(first, second, drive(+(process.argv[2] ?? 50)), asked);
