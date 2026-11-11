"use strict";
const names = Object.create(null);
Object.defineProperty(names, "0", { value: "zero", enumerable: true });
Object.defineProperty(names, "__proto__", { value: "own", enumerable: true });
Object.defineProperty(names, "plain", { value: "plain", enumerable: true });
Object.defineProperty(names, "4294967295", { value: "large", enumerable: true });
function drive(turns) { let s = ""; for (let i = 0; i < turns; i++) s = names[0] + names["0"] + names.__proto__ + names.plain + names[4294967295]; return s; }
console.log(drive(+(process.argv[2] ?? 5)), Object.keys(names).join(), Object.getPrototypeOf(names));
