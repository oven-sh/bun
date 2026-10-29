// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.cjs
// `arguments` at the top of a CommonJS file is the arguments object of `function (exports, require, module, __filename, __dirname) { .. }`: five arguments, which in sloppy code are one variable with the five parameters.
console.log(arguments.length);
console.log(arguments[0] === exports, arguments[1] === require, arguments[2] === module);
console.log(arguments[3] === __filename, arguments[4] === __dirname, arguments[5]);
console.log(typeof arguments, Object.prototype.toString.call(arguments), Array.isArray(arguments));
console.log(typeof arguments.callee, arguments.callee.length);

const fromArrow = (...own) => [arguments.length, own.length];
function ownObject() { return arguments.length; }
console.log(fromArrow(1, 2), ownObject(1, 2));
{
  console.log(arguments.length, (() => () => arguments[2] === module)()());
}

const firstExports = exports;
arguments[0] = "stored through the object";
console.log(exports, module.exports === firstExports);
exports = "stored to the parameter";
console.log(arguments[0]);
(() => { arguments[0] = firstExports; })();
console.log(exports === firstExports);

const firstRequire = require;
arguments[1] = (name) => "not loaded: " + name;
console.log(require("./strict.cjs"));
require = firstRequire;
console.log(arguments[1] === firstRequire);

__filename = "renamed";
console.log(arguments[3]);
delete arguments[4];
arguments[4] = "no longer mapped";
console.log(__dirname === "no longer mapped", arguments[4]);

require("./strict.cjs");
require("./redeclared.cjs");
require("./assigned.cjs");
require("./shadowed.cjs");
require("./called-again.cjs");
require("./free-name-in-module.mjs");

// FILE: assigned.cjs
const object = arguments;
console.log(arguments === object, object.length);
var arguments = ["replaced"];
console.log(arguments.length, arguments[0], object.length);
object[0] = "still mapped";
console.log(exports);

// FILE: called-again.cjs
if (typeof exports === "number") {
  console.log("again", exports, require, arguments.length);
} else {
  console.log("first", typeof exports, typeof require, arguments.length);
  arguments.callee(7);
}

// FILE: free-name-in-module.mjs
console.log(typeof arguments);
try {
  arguments;
} catch (error) {
  console.log(error instanceof ReferenceError);
}
console.log((() => typeof arguments)());

// FILE: redeclared.cjs
var arguments;
var exports, module;
console.log(arguments.length, arguments[0] === exports, arguments[2] === module);
arguments[0] = "stored through the object";
console.log(exports);
module = "stored to the variable";
console.log(arguments[2]);

// FILE: shadowed.cjs
function arguments() {}
console.log(typeof arguments, arguments.length);
{
  let arguments = "in a block";
  console.log(arguments);
}

// FILE: strict.cjs
"use strict";
console.log(arguments.length, arguments[0] === exports, arguments[2] === module);
arguments[0] = "stored through the object";
console.log(exports === module.exports, arguments[0]);
exports = "stored to the parameter";
console.log(arguments[0]);
try {
  arguments.callee;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log((() => arguments.length)());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: ownObject fromArrow
// CHECK-LABEL: function {{*}}name="ownObject"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: function, v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateMappedArguments v0, v1, v2
// CHECK-NEXT: v4 = PropGet v3 key="length"
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fromArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy, HasRestParameter] captures=[{type=anything}] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = PropGet v1 key="length"
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = NewArray v2, v4 contents=anything
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
