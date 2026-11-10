"use strict";
// STATISTIC: ArrayIterationsWithStringFallback >= 1
const log = [];
const outside = JSON.parse('["a,b,(c,d),e", "{x,{y}},z", "", "((", "\\ud83d\\ude00,(\\u4e2d)"]');
const depth = input => { let deep = 0, parts = 1, odd = 0; for (const ch of input) { switch (ch) { case "(": case "{": deep++; break; case ")": case "}": deep--; break; case ",": if (!deep) parts++; break; default: odd++; } } return parts + "/" + deep + "/" + odd; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
const veil = { depth: input => depth(unknown(input)) };
for (let turn = 0; turn < 3; turn++) for (const text of outside) log.push(veil.depth(text), veil.depth(text.split("")), veil.depth(new Set(text)), veil.depth([text, ",", 1, null, "(("]));
console.log("SAID", log.join(" | "));
