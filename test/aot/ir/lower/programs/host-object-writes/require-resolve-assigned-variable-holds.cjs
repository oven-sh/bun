// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// Require resolve is assigned through a variable that holds require.
const load = require; load.resolve = name => "mine " + name; console.log(load.resolve("./next.cjs"), require.resolve("./next.cjs"));

// FILE: next.cjs
console.log("the next file");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
