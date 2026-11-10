"use strict";
// STATISTIC: AnswersOfLookupsAskedForNumbers >= 2
const table = new Map(Object.entries(JSON.parse("{\"a\":\"text\",\"b\":2}")));
function sum(n) { let s = 0; for (let i = 0; i < n; i++) s += table.get("a") + table.get("b"); return s; }
const few = JSON.parse("[0,0,1,0,2]"); console.log(few.map(n => sum(n | 0)).join("|"));
