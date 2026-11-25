// The export is imported and called; the function beside it is not.
// STATISTIC: FunctionsLowered >= 300
import { pick } from "./tools.mjs";
console.log(String(pick([1, [2]], ["fl", "at"].join("")).call([1, [2]])));
