import { prices } from "./prices";
import { column } from "./tables";
const names = column("names", { first: 1 });
let row: Record<string, any> = {};
const load = () => row;
const save = (change: (row: any) => any) => {
  row = change(row);
};
const a = names(load, save);
const b = prices(load, save);
console.log(JSON.stringify(a.read()), JSON.stringify(b.read()));
b.write(cell => ({ ...cell, more: 1 }));
console.log(JSON.stringify(row));
