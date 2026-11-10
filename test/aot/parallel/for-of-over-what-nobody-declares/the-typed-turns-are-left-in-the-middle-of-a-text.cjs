"use strict";
// STATISTIC: IterationsOverListsThatStepTextsBeside >= 1
const log = [];
const outside = JSON.parse('["abc", "ab#cd", "a^bc", "a~bcd", "####", "a,b,c,d,e,f", "\\ud83d\\ude00#\\ud83d\\ude00", "xyz^#"]');
const tally = input => { let total = 0, seen = ""; for (const ch of input) { if (ch === "#") total = total + "#"; else if (ch === "^") total = { valueOf() { return 7; } }; else if (ch === "~") total = 2 ** 53; else total = total + 1; seen += ch; } return String(total) + ":" + seen; };
const wide = input => { let at = 2147483640, seen = ""; for (const ch of input) { if (ch === ",") at += 3; else at++; seen = ch + seen; } return at + ":" + seen; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
const veil = { tally: input => tally(unknown(input)), wide: input => wide(unknown(input)) };
for (let turn = 0; turn < 3; turn++) for (const text of outside) log.push(veil.tally(text), veil.tally(text.split("")), veil.wide(text), veil.wide(text.split("")));
console.log("SAID", log.join(" | "));
