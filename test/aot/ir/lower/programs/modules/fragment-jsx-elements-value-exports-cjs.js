// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// view.js says `@jsxFrag exports.F`.
console.log(require("./view.js").v);

// FILE: view.js
/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag exports.F */
function h(tag) {
  return "h:" + tag;
}
exports.F = "fragment";
exports.v = <></>;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
