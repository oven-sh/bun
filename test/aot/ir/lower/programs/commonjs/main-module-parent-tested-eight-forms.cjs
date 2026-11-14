// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// The main module and the parent are only tested in eight forms.
console.log(require.main === module, !!require.main, typeof require.main, require.main == null, process.mainModule === module);
const a = require("./a.cjs");
console.log(a.r.join());

// FILE: a.cjs
exports.r = [require.main === module, require.main === module.parent, !!module.parent, module.parent == null, typeof module.parent, module.parent && 1, (module.parent || 0) === require.main, module.parent ? "y" : "n"];

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
