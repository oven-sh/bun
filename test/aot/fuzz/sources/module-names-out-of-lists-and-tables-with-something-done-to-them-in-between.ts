// fuzz/module-names-out-of-lists-and-tables-with-something-done-to-them-in-between.ts: a list or a table holds names of files, something is done to it, which may change
// what it holds, and a loader is called with each name. An executable holds the files that are loaded and prints what plain Bun prints.
import { generate } from "../module-names-out-of-lists-and-tables-with-something-done-to-them-in-between";
import { Random } from "../random";
import { endless } from "../family";

export default endless("module names out of lists and tables with something done to them in between", index => ({
  name: `seed ${index + 1}.`,
  make: () => generate(new Random(index + 1)),
}));
