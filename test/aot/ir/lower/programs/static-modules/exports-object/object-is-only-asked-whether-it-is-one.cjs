// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// `this`, `exports` and `module.exports` are objects, also where nothing but that is asked of them.
const byThis = require("./this.cjs"), byName = require("./name.cjs"), byModule = require("./module.cjs");
console.log(byThis.a, byThis.log, byThis.b, byThis.c);
console.log(byName.a, byName.log, byName.b, byName.c);
console.log(byModule.a, byModule.log, byModule.b, byModule.c);

// FILE: module.cjs
exports.a = 1;
exports.log = [!module.exports, module.exports == null, module.exports === undefined, module.exports != null, module.exports ? "object" : "nothing", typeof (module.exports && 5)].join();
if (module.exports) exports.b = 2;
module.exports && (exports.c = 3);

// FILE: name.cjs
exports.a = 1;
exports.log = [!exports, exports == null, exports === undefined, exports != null, exports ? "object" : "nothing", typeof (exports && 5)].join();
if (exports) exports.b = 2;
exports && (exports.c = 3);

// FILE: this.cjs
exports.a = 1;
exports.log = [!this, this == null, this === undefined, this != null, this ? "object" : "nothing", typeof (this && 5)].join();
if (this) exports.b = 2;
this && (exports.c = 3);

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
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v10 = Boolean boolean=true
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v18 = Convert v17 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v22 = Convert v21 declared={type=2 flags=[IsExpected]}
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v24 = Convert v23 declared={type=3 flags=[IsExpected]}
// CHECK-NEXT: v25 = Call v16, v14, v18, v20, v22, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="console" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v32 = Convert v31 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v36 = Convert v35 declared={type=2 flags=[IsExpected]}
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v38 = Convert v37 declared={type=3 flags=[IsExpected]}
// CHECK-NEXT: v39 = Call v30, v28, v32, v34, v36, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Builtin builtin=GlobalThis
// CHECK-NEXT: v41 = PropGet v40 key="console" [isFreeName]
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v43 = PropGet v42 key="log"
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v46 = Convert v45 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v47 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v49 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v50 = Convert v49 declared={type=2 flags=[IsExpected]}
// CHECK-NEXT: v51 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v52 = Convert v51 declared={type=3 flags=[IsExpected]}
// CHECK-NEXT: v53 = Call v44, v42, v46, v48, v50, v52 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v54 = Undefined
// CHECK-NEXT: Return v54
// CHECK-NEXT: }
