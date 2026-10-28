import { prices } from "./prices.js";
import { column } from "./tables.js";
const names = column("names", /first/);
let row = {};
const load = () => row;
const save = change => {
  row = change(row);
};
const a = names(load, save);
const b = prices(load, save);
console.log(String(a.read()), String(b.read()), "a low and a high".replace(b.read(), "-"));
b.write(cell => new RegExp(cell.source + "|more", cell.flags));
console.log(String(row.prices));
