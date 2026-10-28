// The entry point imports first.cjs, which requires waits.mjs, which awaits and imports the entry point. The entry point has not begun when first.cjs runs, so the require() runs it.
import "./first.cjs";
import { count } from "./waits.mjs";
export var first = "main.first";
console.log("main begins");
try {
  console.log("main reads count", count);
} catch (error) {
  console.log("main reads count and throws", error.name);
}
console.log("main ends");
setTimeout(() => console.log("the end", count), 1);
