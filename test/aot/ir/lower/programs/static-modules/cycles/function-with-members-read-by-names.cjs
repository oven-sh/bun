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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v15 = Call v11, v9, v12, v13, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: v23 = Call v21, v22 calleeName="user.read"
// CHECK-NEXT: v24 = Call v20, v18, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
