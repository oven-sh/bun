// Three entry points. The first imports helpers.mjs, which requires drains.mjs before it stores its variable. A text in drains.mjs calls import() on the third entry point, which reads that variable: the loader runs it before the require() returns, and the variable is still undefined.
// Entry points: ./reads.mjs ./drains.mjs
import "./helpers.mjs";
console.log("main ends");
