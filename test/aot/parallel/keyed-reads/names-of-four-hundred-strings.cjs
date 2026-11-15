// The names of strings that come as fresh characters are remembered for some hundred strings.
// COUNTER: operationAOTGetByValGeneric <= 4000
"use strict";
const words = [];
for (let i = 0; i < 400; i++) words.push(String.fromCharCode(65 + i % 26, 65 + (i / 26 | 0) % 26) + "x" + (i * 7919 % 1000));
const table = {};
for (let i = 0; i < words.length; i += 2) table[words[i]] = i;
const other = { __proto__: null };
for (let i = 1; i < words.length; i += 4) other[words[i]] = -i;
let text = "";
for (const word of words) text += (text ? " " : "") + word;
function lookUp(list) {
  let sum = 0, absent = 0;
  for (let i = 0; i < list.length; i++) {
    const found = table[list[i]];
    if (found === undefined) absent++;
    else sum += found;
    const second = other[list[i]];
    if (second !== undefined) sum += second;
  }
  return sum + ":" + absent;
}
const seen = new Set;
for (let round = 0; round < 40; round++) seen.add(lookUp((text + (round % 2 ? " " : "")).split(" ")));
console.log([...seen].join());
table.AAx0 = 123456; delete table[words[2]]; Object.defineProperty(table, words[4], { get() { return 1000000; } });
console.log(lookUp((text + " ").split(" ")));
const wide = text.replace("AAx0", "ĀAx0").split(" ");
console.log(lookUp(wide));
