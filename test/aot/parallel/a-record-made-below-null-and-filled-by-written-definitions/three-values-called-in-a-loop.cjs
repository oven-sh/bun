"use strict";
function add(a, b) { return (a + b) | 0; }
function scale(a, by) { return (a * by) | 0; }
const names = Object.create(null);
Object.defineProperty(names, "add", { value: add });
Object.defineProperty(names, "scale", { value: scale });
function drive(turns) { let s = 1; for (let i = 0; i < turns; i++) s = names.scale(names.add(s, i), 3) % 1009; return s; }
console.log(drive(+(process.argv[2] ?? 50)));
