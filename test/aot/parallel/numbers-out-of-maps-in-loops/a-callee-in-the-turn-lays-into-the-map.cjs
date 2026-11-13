"use strict";
// STATISTIC: MapResultsGuardedAsNumbers = 2
const turns = JSON.parse("8") | 0;
// What is called in the turn stores into the Map. The name is told apart and the store is seen: each turn looks the numbers up again and asks for them where they are read.
const table = new Map(Object.entries(JSON.parse("{\"a\":1,\"b\":2}"))), T = { bump(i) { table.set("a", i & 2 ? "s" : i); } }, k = JSON.parse("\"bump\"");
function sum() { let s = 0; for (let i = 0; i < turns; i++) { s += table.get("a") + table.get("b"); T[k](i); } return s; }
console.log(sum()); console.log(sum());
