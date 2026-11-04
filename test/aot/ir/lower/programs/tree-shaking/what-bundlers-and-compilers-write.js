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

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="esbuild"
// CHECK-NEXT: v7 = Call v6 calleeName="esbuild"
// CHECK-NEXT: v8 = Call v4, v2, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="console" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="log"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="webpack"
// CHECK-NEXT: v16 = Call v15 calleeName="webpack"
// CHECK-NEXT: v17 = Call v13, v11, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="umd"
// CHECK-NEXT: v25 = PropGet v24 key="greet"
// CHECK-NEXT: v26 = Call v25, v24 calleeKey="greet" calleeName="umd.greet"
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="umd"
// CHECK-NEXT: v29 = PropGet v28 key="version"
// CHECK-NEXT: v30 = Call v29, v28 calleeKey="version" calleeName="umd.version"
// CHECK-NEXT: v31 = Call v22, v20, v26, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Builtin builtin=GlobalThis
// CHECK-NEXT: v33 = PropGet v32 key="console" [isFreeName]
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="log"
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="rollup"
// CHECK-NEXT: v39 = Call v38 calleeName="rollup"
// CHECK-NEXT: v40 = Call v36, v34, v39 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v41 = Builtin builtin=GlobalThis
// CHECK-NEXT: v42 = PropGet v41 key="console" [isFreeName]
// CHECK-NEXT: v43 = Convert v42 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v43 key="log"
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v46 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v47 = CheckInitialized v46 name="typescript"
// CHECK-NEXT: v48 = Call v47 calleeName="typescript"
// CHECK-NEXT: v49 = Call v45, v43, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Builtin builtin=GlobalThis
// CHECK-NEXT: v51 = PropGet v50 key="console" [isFreeName]
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v53 = PropGet v52 key="log"
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v55 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v56 = CheckInitialized v55 name="babel"
// CHECK-NEXT: v57 = Call v56 calleeName="babel"
// CHECK-NEXT: v58 = Call v54, v52, v57 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v59 = Undefined
// CHECK-NEXT: Return v59
// CHECK-NEXT: }
