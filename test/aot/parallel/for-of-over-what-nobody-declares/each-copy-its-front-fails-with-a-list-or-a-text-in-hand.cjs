"use strict";
// STATISTIC: IterationsOverListsThatStepTextsBeside >= 1
// STATISTIC: LoopsOfIterationsBuiltForTextsAndForLists >= 1
const log = [];
const outside = JSON.parse('[["a", "+", "b", "+"], "a+b+", [], "", ["+"], "+", ["\\ud83d\\ude00", "+"], "\\ud83d\\ude00+"]');
const starts = JSON.parse('[0, 1, 0.5, 2147483646, 9007199254740991, -0, "s", null, true, [1], {"k": 1}]');
const tally = (input, s) => { for (const ch of input) { if (ch === "+") s++; } return s; };
const weigh = (input, s, step) => { for (const ch of input) { if (ch === "+") s = s + step; else s = s - 1; } return s; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
for (let turn = 0; turn < 2; turn++) for (const given of outside) for (const start of starts) log.push(String(tally(unknown(given), unknown(start))), String(weigh(unknown(given), unknown(start), unknown(starts[(turn + 2) % starts.length]))));
console.log("SAID", log.join(" | "));
