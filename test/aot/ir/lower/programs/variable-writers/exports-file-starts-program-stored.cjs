// RUN: lower
// OPTIONS: builtin-modules

// The file that starts the program stores into its own exports and replaces them through require.main and process.mainModule.
const out = [];
out.push(require.main === module, require.main.exports === exports); require.main.exports.viaMain = 7; out.push(exports.viaMain, module.exports.viaMain);
process.mainModule.exports = { swapped: 8 }; out.push(module.exports.swapped, exports.swapped);
exports = { local: 1 }; out.push(module.exports.local, require.main.exports.swapped);
console.log(JSON.stringify(out));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy, IsHiddenInStackTraces] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v4 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v5 = String string="/$bunfs/root/exports-file-starts-program-stored.cjs"
// CHECK-NEXT: v6 = String string="/$bunfs/root"
// CHECK-NEXT: v7 = CallDirect v1, v1, v3, v4, v5, v6 function=[[f_3]]
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] flags=[IsSloppy, HasThis] length=5 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything, v5: anything):
// CHECK-NEXT: v6 = Convert v2 declared={type=builtin(ModuleRequire) flags=[IsExpected]}
// CHECK-NEXT: v7 = Convert v3 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v8 = Data data=[[d_4]]
// CHECK-NEXT: v9 = PropGet v8 key="push"
// CHECK-NEXT: v10 = Boolean boolean=true
// CHECK-NEXT: v11 = PropGet v6 key="main"
// CHECK-NEXT: v12 = PropGet v11 key="exports"
// CHECK-NEXT: v13 = StrictEq v12, v1
// CHECK-NEXT: v14 = Call v9, v8, v10, v13 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v15 = PropGet v6 key="main"
// CHECK-NEXT: v16 = PropGet v15 key="exports"
// CHECK-NEXT: v17 = Integer integer=7
// CHECK-NEXT: PropSet v16, v17 key="viaMain" mode=Sloppy
// CHECK-NEXT: v19 = PropGet v8 key="push"
// CHECK-NEXT: v20 = PropGet v1 key="viaMain"
// CHECK-NEXT: v21 = PropGet v7 key="exports"
// CHECK-NEXT: v22 = PropGet v21 key="viaMain"
// CHECK-NEXT: v23 = Call v19, v8, v20, v22 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v24 = Builtin builtin=Process
// CHECK-NEXT: v25 = PropGet v24 key="mainModule"
// CHECK-NEXT: v26 = Data data=[[d_5]]
// CHECK-NEXT: PropSet v25, v26 key="exports" mode=Sloppy
// CHECK-NEXT: v28 = PropGet v8 key="push"
// CHECK-NEXT: v29 = PropGet v7 key="exports"
// CHECK-NEXT: v30 = PropGet v29 key="swapped"
// CHECK-NEXT: v31 = PropGet v1 key="swapped"
// CHECK-NEXT: v32 = Call v28, v8, v30, v31 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v33 = Data data=[[d_6]]
// CHECK-NEXT: v34 = PropGet v8 key="push"
// CHECK-NEXT: v35 = PropGet v7 key="exports"
// CHECK-NEXT: v36 = PropGet v35 key="local"
// CHECK-NEXT: v37 = PropGet v6 key="main"
// CHECK-NEXT: v38 = PropGet v37 key="exports"
// CHECK-NEXT: v39 = PropGet v38 key="swapped"
// CHECK-NEXT: v40 = Call v34, v8, v36, v39 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v41 = Builtin builtin=GlobalThis
// CHECK-NEXT: v42 = PropGet v41 key="console" [isFreeName]
// CHECK-NEXT: v43 = Convert v42 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v43 key="log"
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v46 = Builtin builtin=JSON
// CHECK-NEXT: v47 = PropGet v46 key="stringify"
// CHECK-NEXT: v48 = Convert v47 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v49 = Call v48, v46, v8 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v50 = Call v45, v43, v49 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v51 = Undefined
// CHECK-NEXT: Return v51
// CHECK-NEXT: }
