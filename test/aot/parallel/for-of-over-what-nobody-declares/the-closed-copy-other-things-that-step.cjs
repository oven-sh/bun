"use strict";
// STATISTIC: IterationsOverListsThatStepTextsBeside >= 1
// STATISTIC: LoopsOfIterationsBuiltForTextsAndForLists >= 1
const log = [];
const outside = JSON.parse('[["a", ",", "a", "b"], "t,t"]');
const parts = input => { let commas = 0, rest = ""; for (const ch of input) { if (ch === ",") commas++; else rest += "<" + String(ch) + ">"; } return commas + ":" + rest; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
const veil = { parts: input => parts(unknown(input)) };
function* made() { try { yield "g"; yield ","; yield "h"; } finally { log.push("ended"); } }
function args() { return arguments; }
const stepper = { [Symbol.iterator]() { let at = 0; return { next() { log.push("next"); return at++ < 2 ? { done: false, value: at === 1 ? "," : "s" } : { done: true, value: "never" }; }, return() { log.push("returned"); return {}; } }; } };
for (let turn = 0; turn < 2; turn++) for (const thing of [new Set(outside[0]), new Map([[",", 1]]), made(), args("a", ",", "b"), stepper, new String("o,b"), Uint8Array.of(1, 2), new Proxy(["p", ","], {}), outside[0].values(), outside[1][Symbol.iterator](), new Set(outside[1]).keys()]) log.push(veil.parts(thing));
for (const thing of [null, undefined, 5, true, {}, Symbol.iterator, () => {}, 10n]) { try { log.push(veil.parts(thing)); } catch (thrown) { log.push(thrown.constructor.name); } }
console.log("SAID", log.join(" | "));
