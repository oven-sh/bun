"use strict";
// STATISTIC: AnswersOfLookupsAskedForNumbers = 0
const turns = JSON.parse("8") | 0;
// What is called in the turn stores into the Map, behind a name that nobody can follow.
const table = new Map(Object.entries(JSON.parse("{\"a\":1,\"b\":2}"))), T = { bump(i) { table.set("a", i & 2 ? "s" : i); } }, k = JSON.parse("\"bump\"");
function sum() { let s = 0; for (let i = 0; i < turns; i++) { s += table.get("a") + table.get("b"); T[k](i); } return s; }
console.log(sum()); console.log(sum());
