// Two entry points, and both import helpers.mjs, whose `var` holds a constructor function. A text in helpers.mjs requires the second entry point before the store: the helper there is handed undefined, and `new Above()` throws.
// Entry points: ./derives.mjs
import "./helpers.mjs";
console.log("main ends");
