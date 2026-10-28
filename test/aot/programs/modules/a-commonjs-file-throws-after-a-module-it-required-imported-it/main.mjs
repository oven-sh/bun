// first.cjs does not catch what its require() throws. By then waits.mjs has imported first.cjs with what it had exported, and the entry point has run.
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
