// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="lib"

// FILE: main.js
// What stands first in a sequence is evaluated first: the file begins with no object, and its value is the function alone.
function lib(a) { return a + 1; }
module.exports = lib, module.exports.__esModule = true, module.exports["default"] = module.exports;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
