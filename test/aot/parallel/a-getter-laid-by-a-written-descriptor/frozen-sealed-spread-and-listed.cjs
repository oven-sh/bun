"use strict";
const names = { plain: 1 };
Object.defineProperty(names, "add", { enumerable: true, get() { return 7; } });
Object.defineProperty(names, "hidden", { get() { return 9; } });
const turns = +(process.argv[2] ?? 3);
let s = "";
for (let i = 0; i < turns; i++) s += JSON.stringify({ ...names }) + Object.keys(names) + JSON.stringify(names) + Object.getOwnPropertyNames(names) + ("hidden" in names) + Object.isFrozen(names) + ";";
Object.freeze(names);
console.log(s, Object.isFrozen(names), names.add, names.hidden, JSON.stringify(Object.getOwnPropertyDescriptors(names)));
