// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="sloppy"
// CHECK-LABEL: function {{*}}name="storeInStrict"
// CHECK-LABEL: function {{*}}name="storeInSloppy"
// CHECK-LABEL: function {{*}}name="inner"

// FILE: function-bundle-cjs-format-bun-build.cjs
// @bun @bun-cjs
// A function of a bundle in the commonjs format of bun build has a strict directive.
(function(exports, require, module, __filename, __dirname) {// One function of the bundle starts with "use strict", another does not.
function strict() {
  "use strict";
  return typeof this;
}
function sloppy() {
  return typeof this;
}
function storeInStrict() {
  "use strict";
  try {
    undeclaredInStrict = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
function storeInSloppy() {
  undeclaredInSloppy = 1;
  return typeof undeclaredInSloppy;
}
const inner = function () {
  "use strict";
  return (() => typeof this)() + " " + (function () { return typeof this; })();
};
console.log(strict(), sloppy(), storeInStrict(), storeInSloppy(), inner());
})

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
