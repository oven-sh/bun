// What built ins make: programs p map variants. It prints what plain Bun prints.
// @ts-nocheck
// Instructions an entry of new Map(pairs) by the size of the list and the sort of the values.
const [what, sizeText] = process.argv.slice(2);
const size = Number(sizeText), rounds = (200000 / size) * Number(process.env.TIMES ?? 1);
const pairs = [];
for (let i = 0; i < size; i++) pairs.push(["key" + i, what === "objects" ? { i } : what === "numbers" ? i + 0.5 : what === "small" ? i : String("value" + i)]);
for (const pair of pairs) pair[0].charCodeAt(0), typeof pair[1] === "string" && pair[1].charCodeAt(0);
const probe = new Map(pairs);
let kept = 0;
for (let round = 0; round < rounds; round++) kept += what === "none" ? pairs.length : new Map(pairs).size;
console.log(kept, probe.size);
