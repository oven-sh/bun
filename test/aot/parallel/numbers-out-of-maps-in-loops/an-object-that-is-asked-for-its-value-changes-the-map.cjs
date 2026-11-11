"use strict";
// STATISTIC: MapResultsGuardedAsNumbers >= 2
const turns = JSON.parse("8") | 0;
// The first answer is an object. Asked for its value it lays another number under the second key, and counts how often it is asked: once a turn.
const log = []; const table = new Map(); const hide = v => [v][JSON.parse("0")];
table.set("a", hide({ valueOf() { log.push("asked"); table.set("b", table.get("b") + 1); return 1; } })); table.set("b", hide(10));
function sum() { let s = 0; for (let i = 0; i < turns; i++) s += table.get("a") + table.get("b"); return s; }
console.log(sum(), log.length, table.get("b")); console.log(sum(), log.length, table.get("b"));
