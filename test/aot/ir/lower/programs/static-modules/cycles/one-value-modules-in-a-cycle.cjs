// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.cjs
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

// FILE: late-left.cjs
const right = require("./late-right.cjs");
module.exports = function left(n) {
  return n <= 0 ? "left" : right(n - 1);
};

// FILE: late-right.cjs
const left = require("./late-left.cjs");
module.exports = function right(n) {
  return n <= 0 ? "right" : left(n - 1);
};

// FILE: left.cjs
module.exports = left;
const right = require("./right.cjs");
function left(n) {
  return n <= 0 ? "left" : right(n - 1);
}

// FILE: right.cjs
module.exports = right;
const left = require("./left.cjs");
function right(n) {
  return n <= 0 ? "right" : left(n - 1);
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
