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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_7]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v5 key="a"
// CHECK-NEXT: v16 = PropGet v5 key="log"
// CHECK-NEXT: v17 = PropGet v5 key="b"
// CHECK-NEXT: v18 = PropGet v5 key="c"
// CHECK-NEXT: v19 = Call v14, v12, v15, v16, v17, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v29 = Call v24, v22, v25, v26, v27, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v36 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v38 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v39 = Call v34, v32, v35, v36, v37, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
