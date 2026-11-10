"use strict";
// STATISTIC: ArrayIterationsWithStringFallback >= 1
const log = [];
const outside = JSON.parse('[["a", ",", "b"], [",", ",", ",", "x", "y", "z"], ["p", "q", ",", "r", "s"]]');
const grow = (input, same) => { let commas = 0, seen = ""; for (const ch of input) { if (ch === ",") { commas++; if (same.length < 9 && same.push) same.push("+", ","); } else seen += ch; } return commas + ":" + seen; };
const shrink = (input, same) => { let commas = 0, seen = ""; for (const ch of input) { if (ch === ",") { commas++; if (same.pop) same.pop(); } else seen += ch; } return commas + ":" + seen; };
const swap = (input, same) => { let commas = 0, seen = ""; for (const ch of input) { if (ch === ",") { commas++; if (same.pop) { same[same.length - 1] = "!"; same.length = Math.max(2, same.length - 1); } } else seen += ch; } return commas + ":" + seen; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
const veil = { grow: (input, same) => grow(unknown(input), unknown(same)), shrink: (input, same) => shrink(unknown(input), unknown(same)), swap: (input, same) => swap(unknown(input), unknown(same)) };
for (const make of [veil.grow, veil.shrink, veil.swap]) for (const list of outside) { const copy = list.slice(), text = list.join(""); log.push(make(copy, copy), make(text, text)); }
console.log("SAID", log.join(" | "));
