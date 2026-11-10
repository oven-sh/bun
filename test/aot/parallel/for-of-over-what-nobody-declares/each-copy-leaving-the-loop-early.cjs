"use strict";
// STATISTIC: ArrayIterationsWithStringFallback >= 1
// STATISTIC: ForOfLoopsVersionedByIterable >= 1
const log = [];
const outside = JSON.parse('["a b;c", "k=v", "no end", "", ";", "ab!c|d", "x|y"]');
const upTo = input => { let seen = ""; for (const ch of input) { if (ch === ";") break; if (ch === " ") continue; seen += ch; } return seen; };
const find = input => { let at = 0; for (const ch of input) { if (ch === "=") return at; at++; } return -1; };
const nested = input => { let out = ""; outer: for (const ch of input) { if (ch === "|") break; for (const other of input) { if (other === "!") continue outer; if (other === "|") break outer; out += ch + other; } } return out; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
const veil = { upTo: input => upTo(unknown(input)), find: input => find(unknown(input)), nested: input => nested(unknown(input)) };
function* made(text) { try { yield* text; } finally { log.push("ended"); } }
const stepper = text => ({ [Symbol.iterator]() { let at = 0; return { next: () => at < text.length ? { done: false, value: text[at++] } : { done: true, value: undefined }, return() { log.push("returned"); return {}; } }; } });
for (const text of outside) for (const form of [text, text.split(""), made(text), stepper(text), new Set(text)]) log.push(veil.upTo(form));
for (const text of outside) for (const form of [text, text.split(""), made(text), stepper(text)]) log.push(veil.find(form));
for (const text of outside) for (const form of [text, text.split("")]) log.push(veil.nested(form));
console.log("SAID", log.join(" | "));
