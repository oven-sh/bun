// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8

// FILE: main.js
// Files as tools emit them, one per tool: esbuild's __commonJS, __esm and __export; a webpack module map; a UMD wrapper; rollup's frozen namespace; TypeScript's __createBinding, __exportStar and __importStar; Babel's interop helpers. In each the functions are reached through tables, getters and loops of the tool's own run time.
import esbuild from "./esbuild.cjs";
import webpack from "./webpack.cjs";
import umd from "./umd.cjs";
import { rollup } from "./rollup.mjs";
import typescript from "./typescript.cjs";
import babel from "./babel.cjs";

console.log(esbuild());
console.log(webpack());
console.log(umd.greet(), umd.version());
console.log(rollup());
console.log(typescript());
console.log(babel());

// FILE: babel.cjs
"use strict";
function _getRequireWildcardCache(nodeInterop) {
  if (typeof WeakMap !== "function") return null;
  var cache = new WeakMap();
  return (_getRequireWildcardCache = function () { return cache; })(nodeInterop);
}
function _interopRequireWildcard(obj, nodeInterop) {
  if (!nodeInterop && obj && obj.__esModule) return obj;
  if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) return { default: obj };
  var cache = _getRequireWildcardCache(nodeInterop);
  if (cache && cache.has(obj)) return cache.get(obj);
  var newObj = {};
  var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
  for (var key in obj) {
    if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
      var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
      if (desc && (desc.get || desc.set)) Object.defineProperty(newObj, key, desc);
      else newObj[key] = obj[key];
    }
  }
  newObj.default = obj;
  if (cache) cache.set(obj, newObj);
  return newObj;
}
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
var wildcard = _interopRequireWildcard(require("./typescript-source.cjs"));
var _default = _interopRequireDefault(require("./umd.cjs"));
module.exports = function () { return (0, wildcard.viaImportStar)() + ", " + _default.default.greet(); };

// FILE: esbuild.cjs
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() { return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res; };
var __commonJS = (cb, mod) => function __require() { return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports; };
var __export = (target, all) => { for (var name in all) __defProp(target, name, { get: all[name], enumerable: true }); };

var require_old = __commonJS({
  "src/old.js"(exports, module) {
    function helper() { return "helper of old.js"; }
    module.exports = { run: function () { return helper(); } };
  },
});
var new_exports = {};
__export(new_exports, { run: () => run });
function run() { return prefix + "new.js"; }
var prefix;
var init_new = __esm({ "src/new.js"() { prefix = "initialized "; } });

module.exports = function () {
  init_new();
  return require_old().run() + ", " + new_exports.run();
};

// FILE: rollup.mjs
function first() { return "first of a frozen namespace"; }
function second() { return "second"; }
var namespace = /*#__PURE__*/ Object.freeze({ __proto__: null, first: first, second: second });
function pick(object, name) { return object[name]; }
export function rollup() { return pick(namespace, "fir" + "st")() + ", " + Object.keys(namespace).map(name => typeof namespace[name]).join(); }

// FILE: typescript-source.cjs
function viaExportStar() { return "through __exportStar"; }
function viaImportStar() { return "through __importStar"; }
function viaDefault() { return "through its default"; }
exports.viaExportStar = viaExportStar;
exports.viaImportStar = viaImportStar;
exports.viaDefault = viaDefault;

// FILE: typescript.cjs
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? function (o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = { enumerable: true, get: function () { return m[k]; } };
  Object.defineProperty(o, k2, desc);
} : function (o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; });
var __exportStar = (this && this.__exportStar) || function (m, exports) {
  for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __setModuleDefault = Object.create ? function (o, v) { Object.defineProperty(o, "default", { enumerable: true, value: v }); } : function (o, v) { o["default"] = v; };
var __importStar = function (mod) {
  if (mod && mod.__esModule) return mod;
  var result = {};
  if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
  __setModuleDefault(result, mod);
  return result;
};
const barrel = {};
__exportStar(require("./typescript-source.cjs"), barrel);
const star = __importStar(require("./typescript-source.cjs"));
module.exports = function () { return barrel.viaExportStar() + ", " + star.viaImportStar() + ", " + star.default.viaDefault(); };

// FILE: umd.cjs
(function (root, factory) {
  if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Greeter = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function greet() { return "greeted by a UMD module"; }
  function version() { return "1.0"; }
  return { greet: greet, version: version };
});

// FILE: webpack.cjs
var __webpack_modules__ = {
  10: function (module, exports, __webpack_require__) {
    var other = __webpack_require__(20);
    module.exports = function () { return "module 10, " + other.name() + ", " + other.default(); };
  },
  20: function (module, __webpack_exports__, __webpack_require__) {
    __webpack_require__.r(__webpack_exports__);
    __webpack_require__.d(__webpack_exports__, { default: function () { return __WEBPACK_DEFAULT_EXPORT__; }, name: function () { return name; } });
    function name() { return "module 20"; }
    function __WEBPACK_DEFAULT_EXPORT__() { return "its default"; }
  },
};
var __webpack_module_cache__ = {};
function __webpack_require__(moduleId) {
  var cached = __webpack_module_cache__[moduleId];
  if (cached !== undefined) return cached.exports;
  var module = (__webpack_module_cache__[moduleId] = { exports: {} });
  __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
  return module.exports;
}
__webpack_require__.d = function (exports, definition) {
  for (var key in definition) if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
};
__webpack_require__.o = function (object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
__webpack_require__.r = function (exports) { Object.defineProperty(exports, "__esModule", { value: true }); };
module.exports = __webpack_require__(10);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
