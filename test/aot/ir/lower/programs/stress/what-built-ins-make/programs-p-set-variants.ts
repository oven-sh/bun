// RUN: lower
// OPTIONS: builtin-modules

// What built ins make: programs p set variants. It prints what plain Bun prints.
// @ts-nocheck
// Instructions an element of new Set(list) by the sort of the elements.
const [what, sizeText] = process.argv.slice(2);
const size = Number(sizeText), rounds = (200000 / size) * Number(process.env.TIMES ?? 1);
const list = [];
for (let i = 0; i < size; i++) list.push(what === "objects" ? { i } : what === "numbers" ? i + 0.5 : what === "small" ? i : String("value" + i));
for (const element of list) typeof element === "string" && element.charCodeAt(0);
if (what === "mixed") list[size - 1] = { last: true };
if (what === "repeated") for (let i = 0; i < size; i++) list[i] = list[i % 20];
let kept = 0;
for (let round = 0; round < rounds; round++) kept += what === "none" ? list.length : new Set(list).size;
console.log(kept);
