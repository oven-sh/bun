// A list that holds whole numbers takes a list of fractions behind them. It becomes a list of doubles, as it does when the fractions are pushed one by one, and every element reads as it does in plain Bun.
"use strict";
const whole = JSON.parse("[1,2,3]"), fractions = JSON.parse("[0.5,1.5,-0,1e300,4]"), name = JSON.parse('"go"');
const table = { go(first, second) { const made = [...first, ...second]; let text = ""; for (let i = 0; i < made.length; i++) text += (Object.is(made[i], -0) ? "-0" : made[i]) + ","; return made.length + ":" + text; } };
const said = new Set();
for (let turn = 0; turn < 200; turn++) said.add(table[name](whole, fractions) + " " + table[name](fractions, whole) + " " + table[name]([], fractions));
console.log([...said].join(" | "));
