import { from } from "./query.js";
import { honest, odd } from "./rows.js";
import { attempt } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

const chains = {
  sumOfIds: rows => from(rows).pluck("id").sum(),
  firstName: rows => from(rows).where(row => row.id > 1).first().name,
  countTaken: rows => from(rows).take(2).count(),
  firstIdPlusOne: rows => from(rows).pluck("id").first() + 1,
  lengthOfFirstName: rows => from(rows).pluck("name").first().length,
  maybe: rows => from(rows).where(row => row.id > 2).orNothing().count(),
  optional: rows => from(rows).where(row => row.id > 2).orNothing()?.count(),
  unwrapped: rows => from(rows).take(1).unwrap().length,
  asANumber: rows => from(rows) + 1,
  compared: rows => from(rows) > 1,
};
let sum = 0;
for (let i = 0; i < 2000; i++) for (const name in chains) sum += Number(chains[name](honest())) || 1;
console.log("sum", sum);
for (const name in chains) attempt(name + "(honest)", () => chains[name](honest()));
for (const rows in odd) for (const name in chains) attempt(name + "(" + rows + ")", () => chains[name](odd[rows]()));
