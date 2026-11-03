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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = Convert v2 declared={type=builtin(ModuleRequire) flags=[IsExpected]}
// CHECK-NEXT: v7 = Convert v3 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v8 = Data data=[[d_4]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="push"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Boolean boolean=true
// CHECK-NEXT: v14 = PropGet v6 key="main"
// CHECK-NEXT: v15 = PropGet v14 key="exports"
// CHECK-NEXT: v16 = StrictEq v15, v1
// CHECK-NEXT: v17 = Call v12, v10, v13, v16 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v18 = PropGet v6 key="main"
// CHECK-NEXT: v19 = PropGet v18 key="exports"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v21 = Integer integer=7
// CHECK-NEXT: PropSet v20, v21 key="viaMain" mode=Sloppy
// CHECK-NEXT: v23 = PropGet v10 key="push"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v1 key="viaMain"
// CHECK-NEXT: v26 = PropGet v7 key="exports"
// CHECK-NEXT: v27 = PropGet v26 key="viaMain"
// CHECK-NEXT: v28 = Call v24, v10, v25, v27 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v29 = Builtin builtin=Process
// CHECK-NEXT: v30 = PropGet v29 key="mainModule"
// CHECK-NEXT: v31 = Data data=[[d_7]]
// CHECK-NEXT: PropSet v30, v31 key="exports" mode=Sloppy
// CHECK-NEXT: v33 = PropGet v10 key="push"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v7 key="exports"
// CHECK-NEXT: v36 = PropGet v35 key="swapped"
// CHECK-NEXT: v37 = PropGet v1 key="swapped"
// CHECK-NEXT: v38 = Call v34, v10, v36, v37 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v39 = Data data=[[d_8]]
// CHECK-NEXT: v40 = PropGet v10 key="push"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v42 = PropGet v7 key="exports"
// CHECK-NEXT: v43 = PropGet v42 key="local"
// CHECK-NEXT: v44 = PropGet v6 key="main"
// CHECK-NEXT: v45 = PropGet v44 key="exports"
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|number|string|symbol|bigint|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v46 key="swapped"
// CHECK-NEXT: v48 = Call v41, v10, v43, v47 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v49 = Builtin builtin=GlobalThis
// CHECK-NEXT: v50 = PropGet v49 key="console" [isFreeName]
// CHECK-NEXT: v51 = Convert v50 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v52 = PropGet v51 key="log"
// CHECK-NEXT: v53 = Convert v52 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v54 = Builtin builtin=JSON
// CHECK-NEXT: v55 = PropGet v54 key="stringify"
// CHECK-NEXT: v56 = Convert v55 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v57 = Call v56, v54, v10 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v58 = Convert v57 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v59 = Call v53, v51, v58 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v60 = Undefined
// CHECK-NEXT: Return v60
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
