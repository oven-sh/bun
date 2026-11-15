// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="require"
// CHECK-LABEL: function {{*}}name="createRequire"

// FILE: main.cjs
// Require is assigned a function that answers for node module and what it makes is held in a variable.
require = () => ({ createRequire: () => name => console.log("mine", name) }); const load = require("node:module").createRequire(__filename); load("./next.cjs");

// FILE: next.cjs
console.log("the next file");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
