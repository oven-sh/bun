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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v7 variable=[[g_6]]
// CHECK-NEXT: v9 = NewClosure function=[[f_7]]
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="a"
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v14 = Convert v13 declared={type=[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v15 variable=[[g_6]]
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v9 calleeName="read"
// CHECK-NEXT: v23 = Call v21, v19, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v26 = Convert v25 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="n"
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v31 = Convert v30 declared={type=[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v33 = Builtin builtin=GlobalThis
// CHECK-NEXT: v34 = PropGet v33 key="console" [isFreeName]
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="log"
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v32 key="n"
// CHECK-NEXT: v39 = Call v37, v35, v28, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="a"
// CHECK-NEXT: v2 = PropGet v1 key="n"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
