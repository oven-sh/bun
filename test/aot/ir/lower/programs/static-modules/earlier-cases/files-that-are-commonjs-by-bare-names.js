// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 9

// FILE: main.js
// Files that mention `exports`, `module` or `require` only in tests, UMD headers and factories.
const base64 = require("./base64"), filled = require("./filled"), umd = require("./umd"), factory = require("./factory");
require("./shadowed"); require("./typeofs");
console.log(base64.sizeOf("abcd"), base64.looksRight("ab+/"), base64.looksRight("~"), filled.filled, globalThis.fromShadowed, globalThis.kinds);
console.log(typeof umd, umd(), umd._ === umd, umd.moduleExports, typeof globalThis._, factory.made, typeof globalThis.Factory);
console.log(require("./viaes.mjs").all);

// FILE: base64.js
"use strict";
/**
 * As @protobufjs/base64 begins.
 */
var base64 = exports;
base64.sizeOf = function sizeOf(string) { return string.length * 3 / 4; };
base64.looksRight = function looksRight(string) { return /^[A-Za-z0-9+/]*$/.test(string); };

// FILE: esm.js
const module = { exports: "a local called module" }, exports = "a local called exports";
export const seen = module.exports + " / " + exports;

// FILE: factory.js
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) : (global = global || self, factory(global.Factory = {}));
}(this, (function (exports) { 'use strict';
  exports.made = "made by the factory";
})));

// FILE: filled.js
function fill(m) { m.exports = { filled: "filled" }; }
fill(module);

// FILE: shadowed.js
var local = (function (module, exports) { return module + exports; })("mod", "exp");
globalThis.fromShadowed = local;

// FILE: typed.ts
const module = { exports: "typed module" };
export const typed: string = module.exports;

// FILE: typeofs.js
globalThis.kinds = typeof module + " " + typeof exports;

// FILE: umd.js
;(function () {
  var root = typeof globalThis == 'object' && globalThis;
  var freeExports = typeof exports == 'object' && exports && !exports.nodeType && exports;
  var freeModule = freeExports && typeof module == 'object' && module && !module.nodeType && module;
  var moduleExports = freeModule && freeModule.exports === freeExports;
  function lib() { return "lib called"; }
  lib.moduleExports = moduleExports;
  if (freeModule) { (freeModule.exports = lib)._ = lib; freeExports._ = lib; } else { root._ = lib; }
}.call(this));

// FILE: viaes.mjs
import { seen } from "./esm.js";
import { typed } from "./typed.ts";
export const all = seen + " / " + typed;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
