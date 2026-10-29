// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// A function that another file stores under a name of a module is called through the module: `this` is the exports object, also where the function names it in the default of a pattern or in a `case`.
const R = require("./m.cjs");
R.f = function () {
  const { a = this.x } = {};
  return a;
};
R.g = function (kind) {
  switch (kind) {
    case this.x:
      return "same";
  }
  return "other";
};
R.h = function () {
  const [b = this.x] = [];
  return b;
};
console.log(R.f(), R.g(5), R.h());

// FILE: m.cjs
exports.x = 5;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
