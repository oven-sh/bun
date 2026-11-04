// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// `process.mainModule` held as a value, in the entry point and in a file that it requires.
const main = process.mainModule;
console.log(main === module, main === require.main, main.id, main.filename === __filename);
exports.answer = 42;
console.log(main.exports === exports, main.exports.answer, typeof main.require);
require("./other.cjs").show();

// FILE: other.cjs
exports.show = () => console.log(process.mainModule === require.main, process.mainModule !== module, process.mainModule.exports.answer);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_3]]
// CHECK-NEXT: v4 = Builtin builtin=Process
// CHECK-NEXT: v5 = PropGet v4 key="mainModule"
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v12 = StrictEq v5, v11
// CHECK-NEXT: v13 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v14 = PropGet v13 key="main"
// CHECK-NEXT: v15 = StrictEq v5, v14
// CHECK-NEXT: v16 = PropGet v5 key="id"
// CHECK-NEXT: v17 = PropGet v5 key="filename"
// CHECK-NEXT: v18 = String string="{{*}}/main.cjs"
// CHECK-NEXT: v19 = StrictEq v17, v18
// CHECK-NEXT: v20 = Call v10, v8, v12, v15, v16, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v22 = Convert v21 declared={type=[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v23 = Integer integer=42
// CHECK-NEXT: PropSet v22, v23 key="answer" mode=Sloppy
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v5 key="exports"
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v32 = Convert v31 declared={type=[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v33 = StrictEq v30, v32
// CHECK-NEXT: v34 = PropGet v5 key="exports"
// CHECK-NEXT: v35 = PropGet v34 key="answer"
// CHECK-NEXT: v36 = PropGet v5 key="require"
// CHECK-NEXT: v37 = TypeOf v36
// CHECK-NEXT: v38 = Call v29, v27, v33, v35, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: v42 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v43 = Convert v42 declared={type=[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v43 key="show"
// CHECK-NEXT: v45 = Call v44, v43 calleeKey="show" calleeName="show"
// CHECK-NEXT: v46 = Undefined
// CHECK-NEXT: Return v46
// CHECK-NEXT: }
