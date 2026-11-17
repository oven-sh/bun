// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesData = 1
// CHECK-LABEL: function {{*}}name="inner.js"
// CHECK-LABEL: function {{*}}name="__commonJS"
// CHECK-LABEL: function {{*}}name="__require"

// FILE: main.js
// A module inside a bundle requires a json file.
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function __require() {
    return (mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports);
  };
var require_inner = __commonJS({
  "inner.js"(exports, module) {
    module.exports = require("./data.json").version;
  },
});
console.log(require_inner());

// FILE: data.json
{ "version": "1.2.3", "nested": { "port": 80, "deep": { "on": true, "off": null } }, "list": [1, 2, 3] }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
