import { sum } from "./tools.js";
import { attempt } from "./report.js";
import { notLists } from "./values.js";

export function sumImpostors() {
  for (const [name, make] of notLists) attempt("sum, imported by a third module, of " + name, () => sum(make()));
  attempt("sum of a literal string", () => sum("45"));
}
