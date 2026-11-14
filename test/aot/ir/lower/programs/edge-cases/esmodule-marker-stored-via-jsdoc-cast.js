// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2
// CHECK-LABEL: function {{*}}name="_interop"

// FILE: main.js
// `__esModule` stored through a JSDoc cast marks the module, so an interop helper does not box it.
function _interop(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
console.log(_interop(require("./lib")).default.length);

// FILE: lib.js
/** @type {any} */ (exports.__esModule) = true;
exports.default = "d";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
