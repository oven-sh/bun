// first.mjs calls import() on a graph of two levels that is not loaded yet; then this module calls import() on a module that has run. The second promise is settled while the first graph is still being loaded.
import "./first.mjs";
import "./shared.mjs";
console.log("main begins");
import("./shared.mjs").then(() => console.log("main then shared"));
console.log("main ends");
