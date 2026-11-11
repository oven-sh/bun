// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// The same form read by names alone: nobody lists the function's properties or compares it. A member that is stored behind the require that closes the cycle reads undefined from the other module's body, and its value later.
require("./create.cjs");
const user = require("./user.cjs");
console.log(user.early, user.late, user.typeOfTwice);
console.log(user.read());

// FILE: create.cjs
module.exports = create;
module.exports.early = "early";
require("./user.cjs");
module.exports.late = "late";
module.exports.twice = n => n * 2;
function create() {
  return "created";
}

// FILE: user.cjs
const create = require("./create.cjs");
exports.early = create.early;
exports.late = create.late;
exports.typeOfTwice = typeof create.twice === "function" ? "function" : undefined;
exports.read = () => [create.early, create.late, create.twice(1)].join(" ");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
