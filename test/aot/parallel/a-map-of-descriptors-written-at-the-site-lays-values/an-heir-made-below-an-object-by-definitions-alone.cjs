"use strict";
function heirOf(parent, size) { const heir = Object.create(parent); Object.defineProperty(heir, "size", { value: size }); return heir; }
const root = { twice() { return this.size * 2; } };
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { const heir = heirOf(root, i); s += heir.twice() + heir.size; } return s; }
console.log(drive(+(process.argv[2] ?? 50)), Object.getPrototypeOf(heirOf(root, 1)) === root, Object.keys(heirOf(root, 1)).length);
