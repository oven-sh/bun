// file.cjs runs while the loader loads the graph of main.mjs, and requires main.mjs: the whole graph runs inside that require(). The two import() calls are no part of it: what they name runs when it has returned, and asks.cjs can require wanted.mjs.
// `bun run` takes the steps of the calls inside the require(): the inner require() cannot take those of wanted.mjs, and throws.
// `bun build --compile` runs file.cjs to its end first: there a file runs at its place among the imports. Node.js refuses a require() in a cycle.
import "./first.mjs";
import("./asks.cjs").then(
  () => console.log("asks is imported"),
  error => console.log("asks fails:", error.name, error.message.replace(/"[^"]*wanted.mjs"/, "wanted.mjs")),
);
console.log("main runs");
/* Output:
file begins
first runs
main runs
file ends
wanted runs
asks begins
asks ends
wanted is imported
asks is imported
*/
