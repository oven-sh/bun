// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
// A bundle that is an ES module, reads Object.getOwnPropertyNames in its prelude and exports a function declaration.
import { run } from "./lib.mjs";
var sum = 0;
for (var round = 0; round < 1000; round++) sum += run(round);
console.log(run(2), run(1), sum);

// FILE: a-bundle-that-exports-a-function-declaration/leaf.mjs
export const one = 1;

// FILE: a-bundle-that-exports-a-function-declaration/lib.mjs
import { one } from "./leaf.mjs";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_m0 = __commonJS((exports) => {
  exports.c = 1;
  exports.f = function(x) {
    return x + exports.c;
  };
});
var require_m1 = __commonJS((exports) => {
  var a = require_m0();
  exports.c = a.c + 1;
  exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});
var require_m2 = __commonJS((exports, module) => {
  var a = require_m1();
  module.exports.c = a.c + 1;
  module.exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});
export function run(x) { return require_m2().f(x) + one - 1; }

// FILE: a-bundle-that-exports-a-function-declaration/main.mjs
// A bundle that is an ES module, reads Object.getOwnPropertyNames in its prelude and exports a function declaration.
import { run } from "./lib.mjs";
var sum = 0;
for (var round = 0; round < 1000; round++) sum += run(round);
console.log(run(2), run(1), sum);

// FILE: leaf.mjs
export const one = 1;

// FILE: lib.mjs
import { one } from "./leaf.mjs";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_m0 = __commonJS((exports) => {
  exports.c = 1;
  exports.f = function(x) {
    return x + exports.c;
  };
});
var require_m1 = __commonJS((exports) => {
  var a = require_m0();
  exports.c = a.c + 1;
  exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});
var require_m2 = __commonJS((exports, module) => {
  var a = require_m1();
  module.exports.c = a.c + 1;
  module.exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});
export function run(x) { return require_m2().f(x) + one - 1; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
