"use strict";
// STATISTIC: AnswersOfLookupsAskedForNumbers >= 1
const turns = JSON.parse("8") | 0;
// Between the two lookups the turn lays into a list. The second answer is a text. Nothing is laid twice.
const table = new Map(Object.entries(JSON.parse("{\"a\":1,\"t\":\"x\"}"))), log = [];
function sum() { let s = 0; for (let i = 0; i < turns; i++) { s += table.get("a") + 1; log.push(i); s += table.get("t") + 1; } return s; }
console.log(sum(), log.join()); console.log(sum(), log.join());
