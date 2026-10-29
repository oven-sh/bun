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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_3]]
// CHECK-NEXT: v4 = Builtin builtin=Process
// CHECK-NEXT: v5 = PropGet v4 key="mainModule"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v13 = StrictEq v6, v12
// CHECK-NEXT: v14 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v15 = PropGet v14 key="main"
// CHECK-NEXT: v16 = StrictEq v6, v15
// CHECK-NEXT: v17 = PropGet v6 key="id"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v6 key="filename"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v21 = String string="/$bunfs/root/main.cjs"
// CHECK-NEXT: v22 = StrictEq v20, v21
// CHECK-NEXT: v23 = Call v11, v9, v13, v16, v18, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v25 = Convert v24 declared={type=[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v26 = Integer integer=42
// CHECK-NEXT: v27 = Convert v26 declared={type=42 flags=[IsExpected]}
// CHECK-NEXT: PropSet v25, v27 key="answer" mode=Sloppy
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = PropGet v6 key="exports"
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v36 = Convert v35 declared={type=[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v37 = StrictEq v34, v36
// CHECK-NEXT: v38 = PropGet v6 key="exports"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v40 = PropGet v39 key="answer"
// CHECK-NEXT: v41 = PropGet v6 key="require"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v43 = TypeOf v42
// CHECK-NEXT: v44 = Call v33, v31, v37, v40, v43 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: RecordRequire module=[[m_7]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_7]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_7]] referrer=[[m_0]]
// CHECK-NEXT: v48 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v49 = Convert v48 declared={type=[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v51 = PropGet v50 key="show"
// CHECK-NEXT: v52 = Convert v51 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v53 = Call v52, v50 calleeKey="show" calleeName="show"
// CHECK-NEXT: v54 = Undefined
// CHECK-NEXT: Return v54
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
