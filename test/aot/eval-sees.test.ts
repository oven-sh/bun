import { testCells } from "./harness/cells";
import { call, cells, helpers } from "./harness/eval-sees";

// Compiled code and node agree on these, and `bun run` does otherwise:
// where the parameters are not simple, a sloppy eval that declares a name of a parameter makes a variable of its own;
// in a generator that does not name `arguments` itself, an eval sees them all the same.
const parts = [
  /^sloppy \| (parameter with a default|rest) \| (var|function) of the name \|/,
  /\| behind a yield \| arguments \| (written|handed)$/,
];
testCells(
  "every kind of binding met by a direct eval",
  cells().filter(cell => !parts.some(part => part.test(cell.what))),
  1000,
  helpers,
  call,
);
