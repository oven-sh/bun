"use strict";
// STATISTIC: IterationsOverListsThatStepTextsBeside >= 1
// STATISTIC: LoopsOfIterationsBuiltForTextsAndForLists >= 1
const log = [];
const outside = JSON.parse('["ab!c", "!", "fine", ""]');
const strict = input => { let seen = ""; for (const ch of input) { if (ch === "!") throw new RangeError("at " + seen); seen += ch; } return seen; };
const caught = input => { let seen = ""; try { for (const ch of input) { if (ch === "!") throw new RangeError("in"); seen += ch; } } catch (thrown) { seen += "(" + thrown.message + ")"; } finally { seen += "."; } return seen; };
const shelf = outside.slice(0, 0); const unknown = value => { shelf.push(value); return shelf[shelf.length - 1]; };
const veil = { strict: input => strict(unknown(input)), caught: input => caught(unknown(input)) };
function* made(text) { try { yield* text; } finally { log.push("ended"); } }
const stepper = (text, bad) => ({ [Symbol.iterator]() { let at = 0; return { next: () => at < text.length ? { done: false, value: text[at++] } : { done: true, value: undefined }, return() { log.push("returned"); if (bad) throw new TypeError("from return"); return {}; } }; } });
for (const text of outside) for (const form of [text, text.split(""), made(text), stepper(text, false), stepper(text, true), new Set(text)]) { try { log.push(veil.strict(form)); } catch (thrown) { log.push(thrown.constructor.name + ":" + thrown.message); } }
for (const text of outside) for (const form of [text, text.split(""), made(text), stepper(text, false), stepper(text, true)]) { try { log.push(veil.caught(form)); } catch (thrown) { log.push(thrown.constructor.name + ":" + thrown.message); } }
console.log("SAID", log.join(" | "));
