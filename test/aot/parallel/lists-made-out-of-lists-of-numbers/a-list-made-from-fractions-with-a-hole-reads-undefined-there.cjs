// A list of fractions with a hole cannot be copied as numbers: Array.from and a spread read `undefined` at the hole. The list that is made has an own element there, as in plain Bun.
"use strict";
const name = JSON.parse('"go"'), holed = JSON.parse("[0.5,1.5,2.5,3.5]"); delete holed[2];
const table = { go(source) { const made = Array.from(source), spread = [...source]; return made.length + ":" + made.join() + ":" + (2 in made) + ":" + String(made[2]) + " " + spread.join() + ":" + (2 in spread) + ":" + (2 in source); } };
const said = new Set();
for (let turn = 0; turn < 200; turn++) said.add(table[name](holed));
console.log([...said].join(" | "));
