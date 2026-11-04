// The 40 levels of files of ../files-of-40-levels-required, and an ES module imports names and the whole of the top.
import { first, second } from "../files-of-40-levels-required/left-40.cjs";
import * as right from "../files-of-40-levels-required/right-40.cjs";
console.log(first, second, right.first, right.second, right.missing === undefined, "first" in right, "missing" in right);
