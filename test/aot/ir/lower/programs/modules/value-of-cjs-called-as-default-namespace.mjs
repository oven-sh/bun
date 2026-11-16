// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A CommonJS file puts a function in place of `module.exports`. A module calls it as `default` of the namespace of the file, so the namespace is its `this`.
import * as file from "./file.cjs";

console.log(file.default());

// FILE: file.cjs
module.exports = function () {
  return Object.keys(this).join() + " " + this.value + " " + (this.default === module.exports);
};
module.exports.value = 1;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
