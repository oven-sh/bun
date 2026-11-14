// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="getBuiltinModule"

// FILE: main.cjs
// Global is assigned an object whose process answers for node module.
global = { process: { getBuiltinModule: () => ({ createRequire: () => name => console.log("mine", name) }) } }; global.process.getBuiltinModule("node:module").createRequire(__filename)("./next.cjs");

// FILE: next.cjs
console.log("the next file");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
