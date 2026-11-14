"use strict";
// STATISTIC: MapResultsGuardedAsNumbers = 0
const turns = JSON.parse("8") | 0;
// What is called in the turn stores into the Map, and comes from code of which nobody knows anything.
const table = new Map(Object.entries(JSON.parse("{\"a\":1,\"b\":2}"))), bump = new Function("table", "return i => { table.set('a', i & 2 ? 's' : i); }")(table);
function sum() { let s = 0; for (let i = 0; i < turns; i++) { s += table.get("a") + table.get("b"); bump(i); } return s; }
console.log(sum()); console.log(sum());
