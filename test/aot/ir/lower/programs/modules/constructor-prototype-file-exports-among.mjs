// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A CommonJS file exports the object under `prototype` of a function. The function is called and constructs nowhere but through the values of the namespace object.
import * as ns from "./leaf.cjs";
console.log(
  Object.values(ns)
    .map(v => (typeof v === "function" ? v() + typeof new v() : "-"))
    .join(),
);

// FILE: leaf.cjs
function F() {
  return "called";
}
F.prototype.x = 1;
module.exports = F.prototype;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
