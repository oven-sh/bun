import list from "./data/a-list-at-the-top.json";
import text from "./data/a-text-at-the-top.json";
import objectForTheList from "./data/an-object-for-the-list.json";
import fractions from "./data/fractions-and-large-numbers.json";
import honest from "./data/honest.json";
import missing from "./data/missing-and-null.json";
import oddKeys from "./data/odd-keys.json";
import texts from "./data/texts-for-numbers.json";
import load from "./load.cjs";
import { attempt } from "./show.js";
import * as sums from "./sums.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

let sum = 0;
for (let i = 0; i < 2000; i++) sum += sums.total(honest) + sums.names(honest).length + sums.tagCount(honest) + sums.nextCount(honest) + sums.countBits(honest) + sums.room(honest) + sums.firstPrice(honest);
console.log("sum", sum);

const files = { honest, texts, objectForTheList, missing, fractions, oddKeys, list, text };
for (const file in files) for (const use in sums) attempt(use + "(" + file + ")", () => sums[use](files[file]));
const names = ["honest", "texts-for-numbers", "an-object-for-the-list", "missing-and-null", "fractions-and-large-numbers", "odd-keys"];
for (const name of names) attempt("required by a computed name: total(" + name + ")", () => sums.total(load(name)));
honest.items.push({ name: "c", price: "3", tags: "" });
attempt("after a store into what was imported", () => [sums.total(honest), sums.total(load("honest")), sums.tagCount(honest)]);
