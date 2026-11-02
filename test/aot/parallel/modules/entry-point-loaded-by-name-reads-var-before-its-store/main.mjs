// Two entry points, and both import helpers.mjs, which requires drains.mjs before it stores its `var`. A text in drains.mjs calls import() on the second entry point: the loader runs it before the require() returns, and it reads undefined.
// Entry points: ./reads.mjs
import "./helpers.mjs";
console.log("main ends");
