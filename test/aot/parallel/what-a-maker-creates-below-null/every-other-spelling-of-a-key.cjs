"use strict";
const n = Number(process.argv[2] ?? 3);
class Box { static fill(k) { const t = Object.create(null); t.plain = k; t["quoted"] = k + 1; t["#x"] = k + 2; t[Symbol.for("s")] = k + 3; t["a" + "b"] = k + 4; t[7] = k + 5; return t; } }
const t = Box.fill(n);
console.log(Object.keys(t).join(), t["#x"], t[Symbol.for("s")], t.ab, t[7], t.quoted);
