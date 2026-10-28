import { column, prices } from "./prices.js";
const names = column("names", { first: 1 });
let row = {};
const load = () => row;
const save = change => {
  row = change(row);
};
const a = names(load, save);
const b = prices(load, save);
console.log(JSON.stringify(a.read()), JSON.stringify(b.read()));
b.write(cell => [...cell, 3]);
console.log(JSON.stringify(row));
