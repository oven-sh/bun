// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// Members of exports as targets of patterns and loops.
const m = require("./m.cjs");
console.log(Object.keys(m).join(), m.a, m.b, m.c, m.d);

// FILE: m.cjs
[exports.a, exports.b = 7] = [1];
({ q: exports.c, ...exports.d } = { q: 3, r: 4 });
for (exports.e of [1, 2]);
for (exports.f in { k: 1 });

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
