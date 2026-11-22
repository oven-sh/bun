// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// A CommonJS module is required twice, whole and by a pattern; module.id, __filename and require.main of the entry point.
const helper = require("./commonjs-helper.js");
const { twice } = require("./commonjs-helper.js");
console.log(helper.name, twice(21), module.id === ".", typeof __filename, require.main === module);
exports.done = true;

// FILE: commonjs-helper.js
let loads = 0;
loads++;
module.exports = {
  name: "helper",
  twice(n) {
    return n * 2;
  },
  loads,
};

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
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = Integer integer=21
// CHECK-NEXT: v15 = Call v7, -, v14 calleeName="twice"
// CHECK-NEXT: v16 = String string="."
// CHECK-NEXT: v17 = String string="."
// CHECK-NEXT: v18 = StrictEq v16, v17
// CHECK-NEXT: v19 = String string="string"
// CHECK-NEXT: v20 = Boolean boolean=true
// CHECK-NEXT: v21 = Call v12, v10, v13, v15, v18, v19, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v23 = Convert v22 declared={type=[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v24 = Boolean boolean=true
// CHECK-NEXT: PropSet v23, v24 key="done" mode=Sloppy
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
