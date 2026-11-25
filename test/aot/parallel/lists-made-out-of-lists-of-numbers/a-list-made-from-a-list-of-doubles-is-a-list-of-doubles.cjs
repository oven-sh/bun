// Array.from over a list of fractions makes a list of fractions, kept as the engine keeps such a list: the numbers themselves, not boxed values.
// A loop over it then reads numbers. The engine says how each list is kept; plain Bun says the same.
"use strict";
const { jscDescribe } = require("bun:jsc");
const kept = (list) => (/ArrayWith[A-Za-z0-9]+/.exec(jscDescribe(list)) || ["?"])[0];
const fractions = JSON.parse("[" + Array.from({ length: 300 }, (_, i) => i + 0.5).join() + "]"), name = JSON.parse('"go"');
const table = { go(source) { const made = Array.from(source); let sum = 0; for (let i = 0; i < made.length; i++) sum = sum + made[i] * 2; return kept(made) + " " + sum; } };
const said = new Set();
for (let turn = 0; turn < 200; turn++) said.add(table[name](fractions));
console.log(kept(fractions), [...said].join(" | "));
