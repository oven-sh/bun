// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// A variable that holds the result of a require and is stored again, and a `var` that is declared twice: each holds a value, and a read goes to the module it holds at that moment.
let a = require("./x.cjs");
const read = () => a.n;
a = require("./y.cjs");
console.log(read());
var twice = require("./x.cjs");
const first = twice.n;
var twice = require("./y.cjs");
console.log(first, twice.n);

// FILE: x.cjs
exports.n = "x";

// FILE: y.cjs
exports.n = "y";

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
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = NewObject layout=[[L_3]]
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v4, v8 layout=[[L_3]]
// CHECK-NEXT: v10 = NewClosure v4 function=[[f_7]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v12 = GetEnvironmentField v4 layout=[[L_3]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="a"
// CHECK-NEXT: EvaluateModule module=[[m_9]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v16 = Convert v15 declared={type=[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v4, v18 layout=[[L_3]]
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = Call v11 calleeName="read"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|"x" flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v24, v22, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v30 = Convert v29 declared={type=[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="n"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|"x" flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_9]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v36 = Convert v35 declared={type=[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v39 = Builtin builtin=GlobalThis
// CHECK-NEXT: v40 = PropGet v39 key="console" [isFreeName]
// CHECK-NEXT: v41 = Convert v40 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v42 = PropGet v41 key="log"
// CHECK-NEXT: v43 = Convert v42 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v38 key="n"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|"x" flags=[IsExpected]}
// CHECK-NEXT: v46 = Call v43, v41, v33, v45 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v47 = Undefined
// CHECK-NEXT: Return v47
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=env [[L_3]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|"x" flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: env [[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="a"
// CHECK-NEXT: v3 = PropGet v2 key="n"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|"x" flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
