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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="console" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="log"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = Call v4, -, v10 calleeName="left"
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Call v4, -, v12 calleeName="left"
// CHECK-NEXT: v14 = Integer integer=2
// CHECK-NEXT: v15 = Call v4, -, v14 calleeName="left"
// CHECK-NEXT: v16 = Integer integer=3
// CHECK-NEXT: v17 = Call v4, -, v16 calleeName="left"
// CHECK-NEXT: v18 = Call v9, v7, v11, v13, v15, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v22 = Integer integer=2
// CHECK-NEXT: v23 = Call v20, -, v22 calleeName="lateLeft"
// CHECK-NEXT: Jump -> next b3(v23)
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v24 = CatchValue
// CHECK-NEXT: v25 = PropGet v24 key="constructor"
// CHECK-NEXT: v26 = PropGet v25 key="name"
// CHECK-NEXT: Jump -> next b3(v26)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = Builtin builtin=GlobalThis
// CHECK-NEXT: v29 = PropGet v28 key="console" [isFreeName]
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="log"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v33 = Integer integer=1
// CHECK-NEXT: v34 = Call v20, -, v33 calleeName="lateLeft"
// CHECK-NEXT: v35 = Call v32, v30, v34, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
