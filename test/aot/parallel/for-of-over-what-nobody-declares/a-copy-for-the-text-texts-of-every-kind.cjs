"use strict";
// STATISTIC: IterationsOverListsThatStepTextsBeside >= 1
// STATISTIC: LoopsOfIterationsBuiltForTextsAndForLists >= 1
const log = [];
const outside = JSON.parse('["a,b", "", ",", "caf\\u00e9,\\u4e2d", "\\ud83d\\ude00,\\ud83d\\ude00x", "\\ud83d,\\ude00", "\\ude00\\ud83d", "x\\ud83d"]');
const parts = input => { let commas = 0, rest = ""; for (const ch of input) { if (ch === ",") commas++; else rest += "<" + ch + ">"; } return commas + ":" + rest; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
const veil = { parts: input => parts(unknown(input)) };
for (let turn = 0; turn < 3; turn++) for (const text of outside) log.push(veil.parts(text));
const rope = outside[0] + outside[1] + outside[2]; log.push(veil.parts(rope), veil.parts(rope.slice(2, 9)), veil.parts(rope.substring(1)), veil.parts(String(12.5)), veil.parts(`${outside.length},`));
console.log("SAID", log.join(" | "));
