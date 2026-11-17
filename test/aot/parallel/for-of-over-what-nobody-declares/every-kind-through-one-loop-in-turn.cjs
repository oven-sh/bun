"use strict";
// STATISTIC: ArrayIterationsWithStringFallback >= 1
const log = [];
const outside = JSON.parse('["a,b,c", "src/**/*.{js,ts}", ",", "", "\\ud83d\\ude00,x"]');
const parts = input => { let commas = 0, rest = 0; for (const ch of input) { if (ch === ",") commas++; else rest += ch.length; } return commas * 100 + rest; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
const veil = { parts: input => parts(unknown(input)) };
let sum = 0; for (let turn = 0; turn < 3000; turn++) { const text = outside[turn % outside.length]; const form = turn % 3 === 0 ? text : turn % 3 === 1 ? text.split("") : new Set(text); sum = (sum + veil.parts(form)) % 1000003; } log.push(sum);
console.log("SAID", log.join(" | "));
