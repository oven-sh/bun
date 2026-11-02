// A module hands on the names of a file that are read inside the files require.
import * as names from "./names.mjs";
import { early } from "./one-name.mjs";
console.log("the entry point reads", names.early, names.late, early);
