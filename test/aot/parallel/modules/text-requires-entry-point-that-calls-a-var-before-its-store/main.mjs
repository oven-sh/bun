// Two entry points, and both import helpers.mjs, whose `var` holds a function that creates closures. A text in helpers.mjs requires the second entry point before the store: the variable answers undefined there, and the call throws.
// Entry points: ./calls.mjs
import "./helpers.mjs";
console.log("main ends");
