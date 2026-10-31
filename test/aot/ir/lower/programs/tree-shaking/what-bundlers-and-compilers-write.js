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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="esbuild"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_2]]|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v7 calleeName="esbuild"
// CHECK-NEXT: v9 = Call v4, v2, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="webpack"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v17 calleeName="webpack"
// CHECK-NEXT: v19 = Call v14, v12, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="umd"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="greet"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v30 = Call v29, v27 calleeKey="greet" calleeName="umd.greet"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v33 = CheckInitialized v32 name="umd"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="version"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v37 = Call v36, v34 calleeKey="version" calleeName="umd.version"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v39 = Call v24, v22, v31, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Builtin builtin=GlobalThis
// CHECK-NEXT: v41 = PropGet v40 key="console" [isFreeName]
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v43 = PropGet v42 key="log"
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v46 = CheckInitialized v45 name="rollup"
// CHECK-NEXT: v47 = Call v46 calleeName="rollup"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v49 = Call v44, v42, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Builtin builtin=GlobalThis
// CHECK-NEXT: v51 = PropGet v50 key="console" [isFreeName]
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v53 = PropGet v52 key="log"
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v55 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v56 = CheckInitialized v55 name="typescript"
// CHECK-NEXT: v57 = Convert v56 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v58 = Call v57 calleeName="typescript"
// CHECK-NEXT: v59 = Convert v58 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v60 = Call v54, v52, v59 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v61 = Builtin builtin=GlobalThis
// CHECK-NEXT: v62 = PropGet v61 key="console" [isFreeName]
// CHECK-NEXT: v63 = Convert v62 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v64 = PropGet v63 key="log"
// CHECK-NEXT: v65 = Convert v64 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v66 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v67 = CheckInitialized v66 name="babel"
// CHECK-NEXT: v68 = Convert v67 declared={type=undefined|null|[[f_13]] flags=[IsExpected]}
// CHECK-NEXT: v69 = Call v68 calleeName="babel"
// CHECK-NEXT: v70 = Convert v69 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v71 = Call v65, v63, v70 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v72 = Undefined
// CHECK-NEXT: Return v72
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
