// `const { format } = require("./index.cjs")` in a module that the index requires ahead of its store to `format`: the constant holds undefined for ever, and the call throws. The same function read through a holder at the call works.
const index = require("./index.cjs");
let outcome;
try {
  outcome = index.util.showByPattern(1);
} catch (error) {
  outcome = error.constructor.name;
}
console.log(outcome, index.util.showByHolder(1));
