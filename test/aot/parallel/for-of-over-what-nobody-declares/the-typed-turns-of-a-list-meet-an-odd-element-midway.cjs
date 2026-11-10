"use strict";
// STATISTIC: ArrayIterationsWithStringFallback >= 1
const log = [];
const outside = JSON.parse('[[{"weight": 1}, ",", {"weight": 2}, {"other": 1, "weight": 3}, ",", {"weight": 4}], [",", ",", {"weight": 0.5}, {"weight": "x"}, {"weight": 7}], ["a", ",", "b"], "a,b", [1, 2, ",", 3.5, null], [{"weight": 1}, {"weight": 2}, {"weight": 3}, {"weight": {"valueOf": 1}}, {"weight": 5}]]');
const weigh = input => { let sum = 0; for (const it of input) { if (it === ",") sum += 1; else sum += it.weight; } return sum; };
const sizes = input => { let sum = 0, seen = 0; for (const it of input) { seen++; if (it === ",") continue; sum += it.length * seen; } return sum + ":" + seen; };
const twice = input => { let sum = 0; for (const it of input) { if (it === ",") sum -= 1; else sum += it * 2; } return sum; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
for (let turn = 0; turn < 3; turn++) for (const given of outside) for (const run of [weigh, sizes, twice]) { try { log.push(String(run === weigh ? weigh(unknown(given)) : run === sizes ? sizes(unknown(given)) : twice(unknown(given)))); } catch (thrown) { log.push(thrown.constructor.name); } }
console.log("SAID", log.join(" | "));
