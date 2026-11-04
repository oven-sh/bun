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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v11 = ModuleBuiltin builtin=ModuleObject module=[[m_6]]
// CHECK-NEXT: v12 = PropGet v11 key="exports"
// CHECK-NEXT: RecordRequire module=[[m_7]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_7]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_7]] referrer=[[m_0]]
// CHECK-NEXT: v16 = ModuleBuiltin builtin=ModuleObject module=[[m_7]]
// CHECK-NEXT: v17 = PropGet v16 key="exports"
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: RecordRequire module=[[m_10]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_10]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_10]] referrer=[[m_0]]
// CHECK-NEXT: v25 = Boolean boolean=true
// CHECK-NEXT: RecordRequire module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_11]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: v29 = Boolean boolean=true
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v7 key="sizeOf"
// CHECK-NEXT: v36 = String string="abcd"
// CHECK-NEXT: v37 = Call v35, v7, v36 calleeKey="sizeOf" calleeName="base64.sizeOf"
// CHECK-NEXT: v38 = PropGet v7 key="looksRight"
// CHECK-NEXT: v39 = String string="ab+/"
// CHECK-NEXT: v40 = Call v38, v7, v39 calleeKey="looksRight" calleeName="base64.looksRight"
// CHECK-NEXT: v41 = PropGet v7 key="looksRight"
// CHECK-NEXT: v42 = String string="~"
// CHECK-NEXT: v43 = Call v41, v7, v42 calleeKey="looksRight" calleeName="base64.looksRight"
// CHECK-NEXT: v44 = PropGet v12 key="filled"
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="globalThis" [isFreeName]
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v48 = PropGet v47 key="fromShadowed"
// CHECK-NEXT: v49 = Builtin builtin=GlobalThis
// CHECK-NEXT: v50 = PropGet v49 key="globalThis" [isFreeName]
// CHECK-NEXT: v51 = Convert v50 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v52 = PropGet v51 key="kinds"
// CHECK-NEXT: v53 = Call v34, v32, v37, v40, v43, v44, v48, v52 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v54 = Builtin builtin=GlobalThis
// CHECK-NEXT: v55 = PropGet v54 key="console" [isFreeName]
// CHECK-NEXT: v56 = Convert v55 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v57 = PropGet v56 key="log"
// CHECK-NEXT: v58 = Convert v57 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v59 = TypeOf v17
// CHECK-NEXT: v60 = Call v17 calleeName="umd"
// CHECK-NEXT: v61 = PropGet v17 key="_"
// CHECK-NEXT: v62 = StrictEq v61, v17
// CHECK-NEXT: v63 = PropGet v17 key="moduleExports"
// CHECK-NEXT: v64 = Builtin builtin=GlobalThis
// CHECK-NEXT: v65 = PropGet v64 key="globalThis" [isFreeName]
// CHECK-NEXT: v66 = Convert v65 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v67 = PropGet v66 key="_"
// CHECK-NEXT: v68 = TypeOf v67
// CHECK-NEXT: v69 = PropGet v21 key="made"
// CHECK-NEXT: v70 = Builtin builtin=GlobalThis
// CHECK-NEXT: v71 = PropGet v70 key="globalThis" [isFreeName]
// CHECK-NEXT: v72 = Convert v71 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v73 = PropGet v72 key="Factory"
// CHECK-NEXT: v74 = TypeOf v73
// CHECK-NEXT: v75 = Call v58, v56, v59, v60, v62, v63, v68, v69, v74 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v76 = Builtin builtin=GlobalThis
// CHECK-NEXT: v77 = PropGet v76 key="console" [isFreeName]
// CHECK-NEXT: v78 = Convert v77 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v79 = PropGet v78 key="log"
// CHECK-NEXT: v80 = Convert v79 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: RecordRequire module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_12]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: v84 = Boolean boolean=true
// CHECK-NEXT: v85 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v86 = CheckInitialized v85 name="all"
// CHECK-NEXT: v87 = Call v80, v78, v86 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v88 = Undefined
// CHECK-NEXT: Return v88
// CHECK-NEXT: }
