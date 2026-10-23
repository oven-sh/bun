import { programs } from "./generated/joined-literals";
import { generated } from "./generated/run-generated";

// Read in these ways, five or more joined objects have crashed, been refused or printed another value before.
const waysThatFailed = [
  "copied",
  "copied_more",
  "element_replaced",
  "for_of",
  "in_a_function",
  "index",
  "index_bang",
  "let_array",
  "nested",
  "pairs",
  "pairs_plain",
  "pattern",
  "pushed",
  "stored_by_index",
  "typeof_narrowed",
];
const alwaysRun = new Set(
  ["five", "arrays_k", "exactly6_kind"].flatMap(objects => waysThatFailed.map(way => `${objects}__${way}`)),
);

generated(
  "joined literals",
  programs().map(program => ({
    name: program.name.replaceAll("__", ": ").replaceAll("_", " "),
    isAlwaysRun: alwaysRun.has(program.name),
    make: () => program,
  })),
);
