// The file that is imported holds the function nobody calls. What this file reads by name is asked of the library all the same.
// STATISTIC: FunctionsLowered <= 300
import { isMarked } from "./marks.mjs";
console.log(String(isMarked(Object.prototype)), String([1, [2, [3]]].flat(2).toReversed()), "7".padStart(3, "0"));
