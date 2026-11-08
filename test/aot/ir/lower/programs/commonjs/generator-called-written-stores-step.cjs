// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// A generator called where it is written stores to exports step by step.
const m = require("./m.cjs");
console.log(m.a, m.b, m.c, Object.keys(m).join());
m.it.next();
console.log(m.a, m.b, m.c, Object.keys(m).join());

// FILE: m.cjs
exports.it = (function* () {
  exports.a = 1;
  yield (exports.b = 2);
  exports.c = 3;
})();
exports.it.next();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
