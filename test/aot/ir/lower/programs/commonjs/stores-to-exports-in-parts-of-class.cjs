// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// Stores to exports in the parts of a class.
const m = require("./m.cjs");
console.log(Object.keys(m).join());

// FILE: m.cjs
class A extends (exports.a = 1, Object) {
  static s = (exports.b = 2);
  [(exports.c = 3)]() {}
  i = (exports.d = 4);
  static { exports.e = 5; }
}
exports.z = 0;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
