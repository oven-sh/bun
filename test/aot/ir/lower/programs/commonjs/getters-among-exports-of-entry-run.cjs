// RUN: lower
// OPTIONS: builtin-modules

// When the entry point has run, Bun looks at what it exports for a server to start. For a CommonJS file that reads every enumerable property of module.exports, so the getters among them run, once each, behind the last statement.
class Validator {}
module.exports = exports = Validator;
let reads = 0;
Object.defineProperty(exports, "shown", { enumerable: true, get: function () { console.log("shown is read", ++reads); return 1; } });
Object.defineProperty(exports, "hidden", { enumerable: false, get: function () { console.log("hidden is read", ++reads); return 2; } });
Object.defineProperty(exports, "failing", { enumerable: true, get: function () { console.log("failing is read", ++reads); throw new Error("from a getter"); } });
Object.defineProperty(exports, "last", { enumerable: true, get() { console.log("last is read", ++reads); return this === Validator; } });
process.on("exit", () => console.log("reads at the exit", reads));
console.log("the last statement");

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy, IsHiddenInStackTraces] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v4 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v5 = String string="/$bunfs/root/getters-among-exports-of-entry-run.cjs"
// CHECK-NEXT: v6 = String string="/$bunfs/root"
// CHECK-NEXT: v7 = CallDirect v1, v1, v3, v4, v5, v6 function=[[f_3]]
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] flags=[IsSloppy, HasThis] length=5 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything, v5: anything):
// CHECK-NEXT: v6 = Convert v3 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v7 = NewClosure function=[[f_4]]
// CHECK-NEXT: v8 = NewClass v7 layout=[[L_5]]
// CHECK-NEXT: PutModuleVariable v8 variable=[[g_6]]
// CHECK-NEXT: v10 = FinishClass v8 layout=[[L_5]]
// CHECK-NEXT: v11 = Convert v10 declared={type=[[f_4]] flags=[IsFromCompiler]}
// CHECK-NEXT: v12 = Convert v10 declared={type=[[f_4]] flags=[IsFromCompiler]}
// CHECK-NEXT: PutModuleVariable v12 variable=[[g_7]]
// CHECK-NEXT: PropSet v6, v12 key="exports" mode=Sloppy
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v16 variable=[[g_8]]
// CHECK-NEXT: v18 = Builtin builtin=Object
// CHECK-NEXT: v19 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v20 = String string="shown"
// CHECK-NEXT: v21 = Boolean boolean=true
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v23 = NewObject layout=[[L_9]]
// CHECK-NEXT: PropDefine v23, v22 key="enumerable"
// CHECK-NEXT: v25 = NewClosure function=[[f_10]]
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v23, v26 key="get"
// CHECK-NEXT: v28 = FinishObject v23
// CHECK-NEXT: v29 = Call v19, v18, v12, v20, v28 calleeName="Object.defineProperty"
// CHECK-NEXT: v30 = Builtin builtin=Object
// CHECK-NEXT: v31 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v32 = String string="hidden"
// CHECK-NEXT: v33 = Boolean
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v35 = NewObject layout=[[L_9]]
// CHECK-NEXT: PropDefine v35, v34 key="enumerable"
// CHECK-NEXT: v37 = NewClosure function=[[f_12]]
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v35, v38 key="get"
// CHECK-NEXT: v40 = FinishObject v35
// CHECK-NEXT: v41 = Call v31, v30, v12, v32, v40 calleeName="Object.defineProperty"
// CHECK-NEXT: v42 = Builtin builtin=Object
// CHECK-NEXT: v43 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v44 = String string="failing"
// CHECK-NEXT: v45 = Boolean boolean=true
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v47 = NewObject layout=[[L_9]]
// CHECK-NEXT: PropDefine v47, v46 key="enumerable"
// CHECK-NEXT: v49 = NewClosure function=[[f_13]]
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v47, v50 key="get"
// CHECK-NEXT: v52 = FinishObject v47
// CHECK-NEXT: v53 = Call v43, v42, v12, v44, v52 calleeName="Object.defineProperty"
// CHECK-NEXT: v54 = Builtin builtin=Object
// CHECK-NEXT: v55 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v56 = String string="last"
// CHECK-NEXT: v57 = Boolean boolean=true
// CHECK-NEXT: v58 = Convert v57 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v59 = NewObject layout=[[L_9]]
// CHECK-NEXT: PropDefine v59, v58 key="enumerable"
// CHECK-NEXT: v61 = NewClosure function=[[f_14]]
// CHECK-NEXT: v62 = Convert v61 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v59, v62 key="get"
// CHECK-NEXT: v64 = FinishObject v59
// CHECK-NEXT: v65 = Call v55, v54, v12, v56, v64 calleeName="Object.defineProperty"
// CHECK-NEXT: v66 = Builtin builtin=Process
// CHECK-NEXT: v67 = PropGet v66 key="on"
// CHECK-NEXT: v68 = Convert v67 declared={type=builtin(EventEmitterPrototypeOn) flags=[IsExpected]}
// CHECK-NEXT: v69 = String string="exit"
// CHECK-NEXT: v70 = NewClosure function=[[f_15]]
// CHECK-NEXT: v71 = Call v68, v66, v69, v70 calleeKey="on" calleeName="process.on"
// CHECK-NEXT: v72 = Builtin builtin=GlobalThis
// CHECK-NEXT: v73 = PropGet v72 key="console" [isFreeName]
// CHECK-NEXT: v74 = Convert v73 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v75 = PropGet v74 key="log"
// CHECK-NEXT: v76 = Convert v75 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v77 = String string="the last statement"
// CHECK-NEXT: v78 = Call v76, v74, v77 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v79 = Undefined
// CHECK-NEXT: Return v79
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Validator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="shown is read"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="reads"
// CHECK-NEXT: v8 = Increment v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="reads"
// CHECK-NEXT: PutModuleVariable v9 variable=[[g_8]]
// CHECK-NEXT: v13 = Call v4, v2, v5, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="hidden is read"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="reads"
// CHECK-NEXT: v8 = Increment v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="reads"
// CHECK-NEXT: PutModuleVariable v9 variable=[[g_8]]
// CHECK-NEXT: v13 = Call v4, v2, v5, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Integer integer=2
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="failing is read"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="reads"
// CHECK-NEXT: v8 = Increment v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="reads"
// CHECK-NEXT: PutModuleVariable v9 variable=[[g_8]]
// CHECK-NEXT: v13 = Call v4, v2, v5, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="Error" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string="from a getter"
// CHECK-NEXT: v18 = Construct v16, -, v17 calleeName="Error"
// CHECK-NEXT: Throw v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="last is read"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="reads"
// CHECK-NEXT: v10 = Increment v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="reads"
// CHECK-NEXT: PutModuleVariable v11 variable=[[g_8]]
// CHECK-NEXT: v15 = Call v6, v4, v7, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="Validator"
// CHECK-NEXT: v18 = StrictEq v1, v17
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="reads at the exit"
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="reads"
// CHECK-NEXT: v8 = Call v4, v2, v5, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
