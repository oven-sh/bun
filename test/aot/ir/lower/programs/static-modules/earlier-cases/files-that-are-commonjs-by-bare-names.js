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

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: v9 = ModuleBuiltin builtin=ModuleObject module=[[m_4]]
// CHECK-NEXT: v10 = PropGet v9 key="exports"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: RecordRequire module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: v15 = ModuleBuiltin builtin=ModuleObject module=[[m_5]]
// CHECK-NEXT: v16 = PropGet v15 key="exports"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v22 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_9]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v24 = Boolean boolean=true
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: v32 = String string="abcd"
// CHECK-NEXT: v33 = Call v30, v31, v32 calleeName="base64.sizeOf"
// CHECK-NEXT: v34 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: v36 = String string="ab+/"
// CHECK-NEXT: v37 = Call v34, v35, v36 calleeName="base64.looksRight"
// CHECK-NEXT: v38 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: v40 = String string="~"
// CHECK-NEXT: v41 = Call v38, v39, v40 calleeName="base64.looksRight"
// CHECK-NEXT: v42 = PropGet v11 key="filled"
// CHECK-NEXT: v43 = Builtin builtin=GlobalThis
// CHECK-NEXT: v44 = PropGet v43 key="globalThis" [isFreeName]
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v46 = PropGet v45 key="fromShadowed"
// CHECK-NEXT: v47 = Builtin builtin=GlobalThis
// CHECK-NEXT: v48 = PropGet v47 key="globalThis" [isFreeName]
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v50 = PropGet v49 key="kinds"
// CHECK-NEXT: v51 = Call v29, v27, v33, v37, v41, v42, v46, v50 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v52 = Builtin builtin=GlobalThis
// CHECK-NEXT: v53 = PropGet v52 key="console" [isFreeName]
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v55 = PropGet v54 key="log"
// CHECK-NEXT: v56 = Convert v55 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v57 = TypeOf v17
// CHECK-NEXT: v58 = Call v17 calleeName="umd"
// CHECK-NEXT: v59 = PropGet v17 key="_"
// CHECK-NEXT: v60 = StrictEq v59, v17
// CHECK-NEXT: v61 = PropGet v17 key="moduleExports"
// CHECK-NEXT: v62 = Builtin builtin=GlobalThis
// CHECK-NEXT: v63 = PropGet v62 key="globalThis" [isFreeName]
// CHECK-NEXT: v64 = Convert v63 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v65 = PropGet v64 key="_"
// CHECK-NEXT: v66 = TypeOf v65
// CHECK-NEXT: v67 = PropGet v20 key="made"
// CHECK-NEXT: v68 = Convert v67 declared={type=undefined|null|"made by the factory" flags=[IsExpected]}
// CHECK-NEXT: v69 = Builtin builtin=GlobalThis
// CHECK-NEXT: v70 = PropGet v69 key="globalThis" [isFreeName]
// CHECK-NEXT: v71 = Convert v70 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v72 = PropGet v71 key="Factory"
// CHECK-NEXT: v73 = TypeOf v72
// CHECK-NEXT: v74 = Call v56, v54, v57, v58, v60, v61, v66, v68, v73 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v75 = Builtin builtin=GlobalThis
// CHECK-NEXT: v76 = PropGet v75 key="console" [isFreeName]
// CHECK-NEXT: v77 = Convert v76 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v78 = PropGet v77 key="log"
// CHECK-NEXT: v79 = Convert v78 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_12]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v81 = Boolean boolean=true
// CHECK-NEXT: v82 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v83 = CheckInitialized v82 name="all"
// CHECK-NEXT: v84 = Convert v83 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v85 = Call v79, v77, v84 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v86 = Undefined
// CHECK-NEXT: Return v86
// CHECK-NEXT: }
