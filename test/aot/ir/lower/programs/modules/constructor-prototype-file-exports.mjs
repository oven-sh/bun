// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A CommonJS file exports the object under `prototype` of a function. Its `constructor` is imported by name and constructs.
import { constructor } from "./leaf.cjs";
console.log(typeof constructor, new constructor().a);

// FILE: leaf.cjs
function F() {
  this.a = 1;
}
module.exports = F.prototype;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
