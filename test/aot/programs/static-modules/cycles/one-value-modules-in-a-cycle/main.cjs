// Two modules that are one function each and call each other. Where `module.exports = f` stands ahead of the require, the other module holds the function. Where it stands behind, the other module holds an empty object, and the call throws.
const left = require("./left.cjs");
console.log(left(0), left(1), left(2), left(3));
const lateLeft = require("./late-left.cjs");
let outcome;
try {
  outcome = lateLeft(2);
} catch (error) {
  outcome = error.constructor.name;
}
console.log(lateLeft(1), outcome);
