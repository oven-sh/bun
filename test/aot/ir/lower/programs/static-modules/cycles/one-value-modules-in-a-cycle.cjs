// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.cjs
// Two modules that are one function each and call each other. Where `module.exports = f` stands ahead of the require, the other module holds the function. Where it stands behind, the other module holds an empty object, and the call throws.
const left = require("./left.cjs");
console.log(left(0), left(1), left(2), left(3));
const lateLeft = require("./late-left.cjs");
let outcome;
try {
  outcome = lateLeft(2);
} catch (error) {
  outcome = error.constructor.name;
}
console.log(lateLeft(1), outcome);

// FILE: late-left.cjs
const right = require("./late-right.cjs");
module.exports = function left(n) {
  return n <= 0 ? "left" : right(n - 1);
};

// FILE: late-right.cjs
const left = require("./late-left.cjs");
module.exports = function right(n) {
  return n <= 0 ? "right" : left(n - 1);
};

// FILE: left.cjs
module.exports = left;
const right = require("./right.cjs");
function left(n) {
  return n <= 0 ? "left" : right(n - 1);
}

// FILE: right.cjs
module.exports = right;
const left = require("./left.cjs");
function right(n) {
  return n <= 0 ? "right" : left(n - 1);
}

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
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = Call v5, -, v11 calleeName="left"
// CHECK-NEXT: v13 = Integer integer=1
// CHECK-NEXT: v14 = Call v5, -, v13 calleeName="left"
// CHECK-NEXT: v15 = Integer integer=2
// CHECK-NEXT: v16 = Call v5, -, v15 calleeName="left"
// CHECK-NEXT: v17 = Integer integer=3
// CHECK-NEXT: v18 = Call v5, -, v17 calleeName="left"
// CHECK-NEXT: v19 = Call v10, v8, v12, v14, v16, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v24 = Integer integer=2
// CHECK-NEXT: v25 = Call v22, -, v24 calleeName="lateLeft"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v25)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v26 = CatchValue
// CHECK-NEXT: v27 = PropGet v26 key="constructor"
// CHECK-NEXT: v28 = PropGet v27 key="name"
// CHECK-NEXT: Jump -> next b6(v28)
// CHECK-NEXT: b6(v29):
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = Integer integer=1
// CHECK-NEXT: v36 = Call v22, -, v35 calleeName="lateLeft"
// CHECK-NEXT: v37 = Call v34, v32, v36, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v38 = Undefined
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
