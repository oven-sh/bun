// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="__commonJS"

// FILE: main.js
// A wrapper that is also held as a value, put into an array and called with an argument.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports) => {
  exports.n = 1;
});
var held = require_a;
console.log(held().n, [require_a].map(wrapper => wrapper().n).join(), require_a(1).n, require_a() === held());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
