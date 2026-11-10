// `pick` is an export of the other file that nobody imports.
// STATISTIC: FunctionsLowered <= 300
import { isMarked } from "./marks.mjs";
console.log(String(isMarked(Object.prototype)), String(isMarked(Array.prototype)));
