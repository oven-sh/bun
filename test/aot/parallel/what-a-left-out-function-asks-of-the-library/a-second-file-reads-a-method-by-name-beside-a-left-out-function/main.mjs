// What the other files read by name is still asked of the library where the first file's key counts for nothing.
// STATISTIC: FunctionsLowered <= 200
import { flatten } from "./lists.mjs";
import { pad } from "./texts.mjs";
console.log(String(flatten([1, [2, [3]]])), pad("7"));
function pickNever(from, key) {
  return from[key];
}
