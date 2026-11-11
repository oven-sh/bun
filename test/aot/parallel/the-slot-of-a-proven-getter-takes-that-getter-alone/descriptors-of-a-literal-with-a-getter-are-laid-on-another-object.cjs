"use strict";
const source = { base: 2, get twice() { return this.base * 2; } };
const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(source));
copy.base = 5;
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += copy.twice + source.twice; return s; }
console.log(drive(+(process.argv[2] ?? 20)));
