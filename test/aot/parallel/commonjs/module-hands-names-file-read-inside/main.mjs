// A module hands on the names of a file that are read inside the files require.
// `bun <file>` has two answers here. In most runs the files that import file.cjs go on while it is still inside its require(), and read `late` before it is stored: so does the executable, always.
// In two lanes of CI file.cjs ended first, as it does in a bundle. So what the executable prints stands here.
import * as names from "./names.mjs";
import { early } from "./one-name.mjs";
console.log("the entry point reads", names.early, names.late, early);

/* Output:
the file begins
the module runs
the names are handed on
one name is handed on
the entry point reads {
  first: 1,
} undefined {
  first: 1,
}
the file ends
*/
