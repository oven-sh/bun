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
// CHECK-NEXT: v31 = Builtin builtin=GlobalThis
// CHECK-NEXT: v32 = PropGet v31 key="console" [isFreeName]
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v34 = PropGet v33 key="log"
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v30 key="r"
// CHECK-NEXT: v37 = PropGet v36 key="join"
// CHECK-NEXT: v38 = Call v37, v36 calleeKey="join" calleeName="a.r.join"
// CHECK-NEXT: v39 = Call v35, v33, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
