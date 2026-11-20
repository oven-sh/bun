"use strict";
const names = Object.create(null, { hidden: { value: 1 }, shown: { value: 2, enumerable: true }, loose: { value: 3, enumerable: true, writable: true, configurable: true }, fixed: { value: 4, enumerable: true, writable: false } });
names.late = 5;
const turns = +(process.argv[2] ?? 2);
let s = "";
for (let i = 0; i < turns; i++) { let listed = ""; for (const key in names) listed += key + ","; s += listed + Object.keys(names) + "|" + Object.getOwnPropertyNames(names) + "|" + JSON.stringify(names) + "|" + JSON.stringify({ ...names }) + ";"; }
console.log(s, JSON.stringify(Object.getOwnPropertyDescriptors(names)));
