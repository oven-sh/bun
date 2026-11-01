// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// A bundle that imports nothing and lies on no cycle. Its importer lies on one, so a function declaration of the bundle is called before the bundle has run: the wrappers are still empty variables.
import "./importer.mjs";

// FILE: a-function-declaration-called-before-its-bundle-has-run/bundle.mjs
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_m0 = __commonJS((exports) => {
  exports.f = function(x) {
    return x + 1;
  };
});
export function run(x) {
  return require_m0().f(x);
}

// FILE: a-function-declaration-called-before-its-bundle-has-run/first.mjs
import { early } from "./importer.mjs";
try {
  console.log("first", early());
} catch (error) {
  console.log("first", error.constructor.name);
}

// FILE: a-function-declaration-called-before-its-bundle-has-run/importer.mjs
import "./first.mjs";
import { run } from "./bundle.mjs";
export function early() {
  return run(1);
}
console.log("importer", early());

// FILE: a-function-declaration-called-before-its-bundle-has-run/main.mjs
// A bundle that imports nothing and lies on no cycle. Its importer lies on one, so a function declaration of the bundle is called before the bundle has run: the wrappers are still empty variables.
import "./importer.mjs";

// FILE: bundle.mjs
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_m0 = __commonJS((exports) => {
  exports.f = function(x) {
    return x + 1;
  };
});
export function run(x) {
  return require_m0().f(x);
}

// FILE: first.mjs
import { early } from "./importer.mjs";
try {
  console.log("first", early());
} catch (error) {
  console.log("first", error.constructor.name);
}

// FILE: importer.mjs
import "./first.mjs";
import { run } from "./bundle.mjs";
export function early() {
  return run(1);
}
console.log("importer", early());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
