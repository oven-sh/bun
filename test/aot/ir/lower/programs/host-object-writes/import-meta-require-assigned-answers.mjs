// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="createRequire"

// FILE: main.mjs
// Import meta require is assigned a function that answers for node module.
import.meta.require = name => ({ createRequire: () => name => console.log("mine", name) }); import.meta.require("node:module").createRequire(import.meta.url)("./next.mjs");

// FILE: next.mjs
console.log("the next file");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
