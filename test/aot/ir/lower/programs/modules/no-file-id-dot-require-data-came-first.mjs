// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2
// STATISTIC: SourceFilesData = 1

// FILE: main.mjs
// No file has the id dot where a require of data came before the first import of a commonjs file.
import.meta.require("./required.json");
await import("./late.cjs");

// FILE: late.cjs
const who = m => (m === undefined ? "undefined" : m === null ? "null" : m.id === "." ? "." : require("node:path").basename(m.filename));
console.log("late: parent", who(module.parent), "id", module.id === "." ? "." : require("node:path").basename(module.id), "main", require.main === module);

// FILE: required.json
{ "a": 1 }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
