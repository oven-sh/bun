// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// The main module and the parent are only tested in eight forms.
console.log(require.main === module, !!require.main, typeof require.main, require.main == null, process.mainModule === module);
const a = require("./a.cjs");
console.log(a.r.join());

// FILE: a.cjs
exports.r = [require.main === module, require.main === module.parent, !!module.parent, module.parent == null, typeof module.parent, module.parent && 1, (module.parent || 0) === require.main, module.parent ? "y" : "n"];

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
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = Boolean boolean=true
// CHECK-NEXT: v9 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v10 = PropGet v9 key="main"
// CHECK-NEXT: v11 = ToBoolean v10
// CHECK-NEXT: v12 = LogicalNot v11
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: v14 = LogicalNot v13
// CHECK-NEXT: v15 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v16 = PropGet v15 key="main"
// CHECK-NEXT: v17 = TypeOf v16
// CHECK-NEXT: v18 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v19 = PropGet v18 key="main"
// CHECK-NEXT: v20 = TypeTest v19 testedType=undefined|null
// CHECK-NEXT: v21 = Builtin builtin=Process
// CHECK-NEXT: v22 = PropGet v21 key="mainModule"
// CHECK-NEXT: v23 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v24 = StrictEq v22, v23
// CHECK-NEXT: v25 = Call v7, v5, v8, v14, v17, v20, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v30 = Convert v29 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v32 = Builtin builtin=GlobalThis
// CHECK-NEXT: v33 = PropGet v32 key="console" [isFreeName]
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="log"
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v31 key="r"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v38 key="join"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v41 = Call v40, v38 calleeKey="join" calleeName="a.r.join"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v43 = Call v36, v34, v42 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v44 = Undefined
// CHECK-NEXT: Return v44
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
