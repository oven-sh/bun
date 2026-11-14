// Every turn makes an object of a class below Map and lays an own property under one of 900 names on it: a structure is examined once between two collections, not whenever it comes round again.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
// COUNT: counter:BuiltinSubclassStructuresExamined <= 5000
"use strict";
class M extends Map { own() { return 1; } }
function f(t) { const m = new M(); m["p" + t % 900] = 1; m.set("a", t & 7); return m.get("a") + m.size; }
const turns = +(process.argv[2] ?? 20000); let sum = 0;
for (let t = 0; t < turns; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
