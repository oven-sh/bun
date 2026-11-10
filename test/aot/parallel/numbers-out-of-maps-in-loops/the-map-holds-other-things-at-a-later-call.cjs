"use strict";
// STATISTIC: MapResultsGuardedAsNumbers >= 2
// STATISTIC: CollectionLookupsHoisted >= 2
const turns = JSON.parse("8") | 0;
const table = new Map(Object.entries(JSON.parse("{\"a\":1,\"b\":2}")));
function sum() { let s = 0; for (let i = 0; i < turns; i++) s += table.get("a") + table.get("b"); return s; }
const out = [sum()]; table.set("b", "x"); out.push(sum()); table.set("b", 2.5); out.push(sum()); table.delete("a"); out.push(String(sum())); table.set("a", null); out.push(sum()); table.set("a", true); out.push(sum()); console.log(out.join("|"));
