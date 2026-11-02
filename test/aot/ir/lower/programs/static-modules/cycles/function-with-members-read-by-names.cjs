// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// The same form read by names alone: nobody lists the function's properties or compares it. A member that is stored behind the require that closes the cycle reads undefined from the other module's body, and its value later.
require("./create.cjs");
const user = require("./user.cjs");
console.log(user.early, user.late, user.typeOfTwice);
console.log(user.read());

// FILE: create.cjs
module.exports = create;
module.exports.early = "early";
require("./user.cjs");
module.exports.late = "late";
module.exports.twice = n => n * 2;
function create() {
  return "created";
}

// FILE: user.cjs
const create = require("./create.cjs");
exports.early = create.early;
exports.late = create.late;
exports.typeOfTwice = typeof create.twice === "function" ? "function" : undefined;
exports.read = () => [create.early, create.late, create.twice(1)].join(" ");

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
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|"function" flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v12, v10, v13, v14, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: v25 = Call v23, v24 calleeName="user.read"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v22, v20, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
