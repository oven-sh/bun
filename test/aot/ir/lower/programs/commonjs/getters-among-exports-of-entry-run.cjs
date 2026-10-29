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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = Convert v3 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v7 = NewObject layout=[[L_4]]
// CHECK-NEXT: v8 = NewClosure function=[[f_5]]
// CHECK-NEXT: v9 = NewClass v8 layout=[[L_6]]
// CHECK-NEXT: v10 = FinishClass v9 layout=[[L_6]]
// CHECK-NEXT: v11 = Convert v10 declared={type=[[f_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v12 = Convert v10 declared={type=[[f_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v6, v13 key="exports" mode=Sloppy
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v7, v16 layout=[[L_4]]
// CHECK-NEXT: v18 = Builtin builtin=Object
// CHECK-NEXT: v19 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v20 = String string="shown"
// CHECK-NEXT: v21 = Boolean boolean=true
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v23 = NewObject layout=[[L_8]]
// CHECK-NEXT: PropDefine v23, v22 key="enumerable"
// CHECK-NEXT: v25 = NewClosure v7 function=[[f_9]]
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v23, v26 key="get"
// CHECK-NEXT: v28 = FinishObject v23
// CHECK-NEXT: v29 = Call v19, v18, v12, v20, v28 calleeName="Object.defineProperty"
// CHECK-NEXT: v30 = Builtin builtin=Object
// CHECK-NEXT: v31 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v32 = String string="hidden"
// CHECK-NEXT: v33 = Boolean
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v35 = NewObject layout=[[L_8]]
// CHECK-NEXT: PropDefine v35, v34 key="enumerable"
// CHECK-NEXT: v37 = NewClosure v7 function=[[f_11]]
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v35, v38 key="get"
// CHECK-NEXT: v40 = FinishObject v35
// CHECK-NEXT: v41 = Call v31, v30, v12, v32, v40 calleeName="Object.defineProperty"
// CHECK-NEXT: v42 = Builtin builtin=Object
// CHECK-NEXT: v43 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v44 = String string="failing"
// CHECK-NEXT: v45 = Boolean boolean=true
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v47 = NewObject layout=[[L_8]]
// CHECK-NEXT: PropDefine v47, v46 key="enumerable"
// CHECK-NEXT: v49 = NewClosure v7 function=[[f_12]]
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v47, v50 key="get"
// CHECK-NEXT: v52 = FinishObject v47
// CHECK-NEXT: v53 = Call v43, v42, v12, v44, v52 calleeName="Object.defineProperty"
// CHECK-NEXT: v54 = Builtin builtin=Object
// CHECK-NEXT: v55 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v56 = String string="last"
// CHECK-NEXT: v57 = Boolean boolean=true
// CHECK-NEXT: v58 = Convert v57 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v59 = NewObject layout=[[L_8]]
// CHECK-NEXT: PropDefine v59, v58 key="enumerable"
// CHECK-NEXT: v61 = NewClosure v7, v12 function=[[f_13]]
// CHECK-NEXT: v62 = Convert v61 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v59, v62 key="get"
// CHECK-NEXT: v64 = FinishObject v59
// CHECK-NEXT: v65 = Call v55, v54, v12, v56, v64 calleeName="Object.defineProperty"
// CHECK-NEXT: v66 = Builtin builtin=Process
// CHECK-NEXT: v67 = PropGet v66 key="on"
// CHECK-NEXT: v68 = Convert v67 declared={type=builtin(EventEmitterPrototypeOn) flags=[IsExpected]}
// CHECK-NEXT: v69 = String string="exit"
// CHECK-NEXT: v70 = NewClosure v7 function=[[f_14]]
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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: env [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="shown is read"
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="reads"
// CHECK-NEXT: v9 = Increment v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="reads"
// CHECK-NEXT: PutEnvironmentField v0, v10 layout=[[L_4]]
// CHECK-NEXT: v14 = Call v5, v3, v6, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: env [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="hidden is read"
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="reads"
// CHECK-NEXT: v9 = Increment v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="reads"
// CHECK-NEXT: PutEnvironmentField v0, v10 layout=[[L_4]]
// CHECK-NEXT: v14 = Call v5, v3, v6, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Integer integer=2
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: env [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="failing is read"
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="reads"
// CHECK-NEXT: v9 = Increment v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="reads"
// CHECK-NEXT: PutEnvironmentField v0, v10 layout=[[L_4]]
// CHECK-NEXT: v14 = Call v5, v3, v6, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="Error" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="from a getter"
// CHECK-NEXT: v19 = Construct v17, -, v18 calleeName="Error"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: Throw v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasThis, HasExplicitName] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}, {type=[[f_5]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: env [[L_4]], v1: [[f_5]], v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = ToThis v2
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="last is read"
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="reads"
// CHECK-NEXT: v12 = Increment v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v14 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="reads"
// CHECK-NEXT: PutEnvironmentField v0, v13 layout=[[L_4]]
// CHECK-NEXT: v17 = Call v8, v6, v9, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = StrictEq v3, v1
// CHECK-NEXT: v19 = Convert v18 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: env [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="reads at the exit"
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="reads"
// CHECK-NEXT: v9 = Call v5, v3, v6, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_20]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
