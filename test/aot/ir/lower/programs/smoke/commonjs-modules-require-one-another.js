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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v18 = Integer integer=21
// CHECK-NEXT: v19 = Call v10, -, v18 calleeName="twice"
// CHECK-NEXT: v20 = Convert v19 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v21 = String string="."
// CHECK-NEXT: v22 = String string="."
// CHECK-NEXT: v23 = StrictEq v21, v22
// CHECK-NEXT: v24 = String string="string"
// CHECK-NEXT: v25 = Boolean boolean=true
// CHECK-NEXT: v26 = Call v15, v13, v17, v20, v23, v24, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v28 = Convert v27 declared={type=[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v29 = Boolean boolean=true
// CHECK-NEXT: v30 = Convert v29 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: PropSet v28, v30 key="done" mode=Sloppy
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
