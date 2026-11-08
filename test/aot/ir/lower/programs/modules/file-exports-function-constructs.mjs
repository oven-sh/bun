// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A CommonJS file exports what `new` makes of a function that stores `constructor` on it.
const names = await import("./first.cjs");
console.log(
  Object.keys(names).join(),
  "|",
  names.hidden,
  names.constructor,
  "hidden" in names,
  "constructor" in names,
  Reflect.ownKeys(names).length,
);

// FILE: first.cjs
function Made() {
  this.one = 1;
  this.constructor = 3;
}
module.exports = new Made();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
