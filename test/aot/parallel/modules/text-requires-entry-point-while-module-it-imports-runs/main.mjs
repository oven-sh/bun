// Two entry points, and both import inner.mjs. A text in inner.mjs makes a require() for itself and requires the second entry point before inner.mjs has stored its variable: the read there throws. No import() and no require() of the program is involved.
// Entry points: ./second.mjs
import "./inner.mjs";
console.log("main ends");
