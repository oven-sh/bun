// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 6

// FILE: main.js
// `exports`, `module`, `require`, `__filename` and `__dirname` are variables of a CommonJS module: a store inside a loop or a `try` is seen by the next iteration, after the statement and by inner functions. Imported CommonJS files are evaluated in import order. Plain Bun has no fixed order for them, so the output is stored.
import "./exports.cjs";
import "./module.cjs";
import "./require.cjs";
import "./paths.cjs";
import "./shared.cjs";

// FILE: exports.cjs
var i = 0;
while (i < 2) { exports = i; i++; }
console.log("exports after while:", exports, typeof module.exports);
for (var j = 0; j < 3; j++) { console.log("exports at the start of iteration " + j + ":", exports); exports = "for " + j; }
do { exports += "!"; } while (exports.length < 8);
console.log("exports after do:", exports);
try { exports = "try"; throw 0; } catch (e) { console.log("exports in catch:", exports); }

// FILE: module.cjs
var original = module;
var i = 0;
while (i < 2) { module = i; i++; }
console.log("module after while:", module, typeof original.exports);
for (module of ["first", "second"]) console.log("module in for-of:", module);
console.log("module after for-of:", module);

// FILE: paths.cjs
console.log("paths at the start:", typeof __filename, typeof __dirname, __filename.startsWith(__dirname));
var i = 0;
do { __filename = "file " + i; __dirname = "directory " + i; i++; } while (i < 2);
console.log("paths after do:", __filename, __dirname);

// FILE: require.cjs
var original = require;
var i = 0;
while (i < 2) { require = i; i++; }
console.log("require after while:", require, typeof original);
for (var j = 0; j < 2; j++) { console.log("require at the start of iteration " + j + ":", typeof require); require = original; }
console.log("require restored:", require === original);

// FILE: shared.cjs
function readExports() { return exports; }
function storeModule(value) { module = value; }
var seen = [];
for (var i = 0; i < 2; i++) { exports = "store " + i; seen.push(readExports()); }
console.log("exports read by a function:", seen.join(), exports);
for (var j = 0; j < 2; j++) { storeModule("store " + j); console.log("module stored by a function:", module); }

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
