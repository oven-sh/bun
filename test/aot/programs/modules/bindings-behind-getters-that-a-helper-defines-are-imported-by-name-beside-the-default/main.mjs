// Two CommonJS files as esbuild writes them: a helper defines a getter for each name of a list, on `exports` or on an object that is copied into
// `module.exports`. A module imports names of both and, beside them, their defaults, which it looks at as a whole.
import older, { number as olderNumber, greet as olderGreet } from "./older.cjs";
import newer, { number as newerNumber, greet as newerGreet } from "./newer.cjs";

console.log(older, olderNumber, olderGreet());
console.log(newer, newerNumber, newerGreet());
