// Objects that start empty and are filled by computed keys: where the same keys come again and again in the same order, however many such orders a program has going at once and however many names it has used only once, the objects settle on shared shapes and none stays a dictionary.
import { describe } from "bun:jsc";
const build = (keys, first) => { const out = {}; for (const key of keys) out[key] = first++; return out; };
const shape = made => describe(made).match(/Structure 0x[0-9a-f]+/)?.[0];
function settle(prefix, rounds) {
  const orders = [];
  for (let i = 0; i < 400; i++) orders.push([prefix + "a" + i, prefix + "b" + i, prefix + "c" + (i % 7), prefix + "d" + i]);
  const kept = [], before = [];
  let sum = 0;
  for (let round = 0; round < rounds; round++)
    for (let i = 0; i < orders.length; i++) { before[i] = kept[i]; kept[i] = build(orders[i], round); sum += kept[i][orders[i][3]] - kept[i][orders[i][0]]; }
  console.log(prefix, "sum", sum);
  console.log(prefix, "dictionaries after", rounds, "rounds:", kept.filter(made => describe(made).includes("ictionary")).length);
  console.log(prefix, "keys", Object.keys(kept[5]).join(), Object.values(kept[47]).join());
  console.log(prefix, "two of one order share a shape:", kept.every((made, i) => shape(made) === shape(before[i])));
}
settle("early", 20);
let once = 0;
for (let i = 0; i < 70000; i++) once += build(["once" + i], i)["once" + i];
console.log("names that came once add up to", once);
settle("late", 200);
