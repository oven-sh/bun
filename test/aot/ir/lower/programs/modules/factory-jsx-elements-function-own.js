// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// view.js says `@jsx exports.h`, and stores to `exports.h` and `exports.v`.
console.log(require("./view.js").v);

// FILE: view.js
/** @jsxRuntime classic */
/** @jsx exports.h */
exports.h = function (tag) {
  return "h:" + tag + ":" + Object.keys(this).join();
};
exports.v = <div />;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
