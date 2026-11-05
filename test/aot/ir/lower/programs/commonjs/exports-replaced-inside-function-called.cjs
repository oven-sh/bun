// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// Exports replaced inside a function called where it is written.
const t = require("./t.cjs");
console.log(JSON.stringify(t), t.f());

// FILE: t.cjs
(function (root, factory) { module.exports = factory(); })(this, function () { return { a: 1, f() { return this.a; } }; });

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
