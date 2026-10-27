import { prices } from "./prices.js";
import { column } from "./tables.js";
const names = column("names", new Map([["first", 1]]));
let row = {};
const load = () => row;
const save = change => {
  row = change(row);
};
const a = names(load, save);
const b = prices(load, save);
console.log([...a.read().keys()].join(), [...b.read().keys()].join());
b.write(cell => new Map([...cell, ["more", 3]]));
console.log([...row.prices.keys()].join());
