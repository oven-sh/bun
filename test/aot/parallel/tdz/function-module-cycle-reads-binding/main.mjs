// The two modules import each other. `b` runs first and calls a function of `a` whose loop reads a binding of `a` in a branch that is not taken yet.
import { sumOfTable, table } from "./a.mjs";
import { early } from "./b.mjs";
console.log(early, sumOfTable(8, 0), table.length);
