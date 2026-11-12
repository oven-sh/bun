"use strict";
const names = Object.create(null);
names.first = 1;
Object.defineProperty(names, "hidden", { value: 2 });
Object.defineProperty(names, "shown", { value: 3, enumerable: true });
names.last = 4;
Object.defineProperty(names, "loose", { value: 5, enumerable: true, writable: true, configurable: true });
const turns = +(process.argv[2] ?? 2);
let s = "";
for (let i = 0; i < turns; i++) { let listed = ""; for (const key in names) listed += key + ","; s += listed + Object.keys(names) + "|" + Object.getOwnPropertyNames(names) + "|" + JSON.stringify(names) + "|" + JSON.stringify({ ...names }) + "|" + ("hidden" in names) + Object.prototype.hasOwnProperty.call(names, "hidden") + ";"; }
console.log(s, JSON.stringify(Object.getOwnPropertyDescriptors(names)));
