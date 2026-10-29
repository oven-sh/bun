// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// A using declaration whose disposal throws at the end of the body.
let m;
try { m = require("./m.cjs"); } catch (e) { console.log("caught", e.message); }
console.log(typeof m);
try { m = require("./m.cjs"); console.log("second", m.a, m.b); } catch (e) { console.log("caught again", e.message); }

// FILE: m.cjs
using r = { [Symbol.dispose]() { throw new Error("dispose"); } };
exports.a = 1;
exports.b = require("./x.cjs").v;

// FILE: x.cjs
console.log("x runs"); exports.v = "x";

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
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5(v4):
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5(v8):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b5(v9) role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="caught"
// CHECK-NEXT: v17 = PropGet v10 key="message"
// CHECK-NEXT: v18 = Call v15, v13, v16, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = TypeOf v19
// CHECK-NEXT: v26 = Call v24, v22, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v29 = Convert v28 declared={type=[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: v31 = Builtin builtin=GlobalThis
// CHECK-NEXT: v32 = PropGet v31 key="console" [isFreeName]
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v34 = PropGet v33 key="log"
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v36 = String string="second"
// CHECK-NEXT: v37 = PropGet v30 key="a"
// CHECK-NEXT: v38 = Convert v37 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v30 key="b"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|"x" flags=[IsExpected]}
// CHECK-NEXT: v41 = Call v35, v33, v36, v38, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b10() role=CatchHandler:
// CHECK-NEXT: v42 = CatchValue
// CHECK-NEXT: v43 = Builtin builtin=GlobalThis
// CHECK-NEXT: v44 = PropGet v43 key="console" [isFreeName]
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v46 = PropGet v45 key="log"
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v48 = String string="caught again"
// CHECK-NEXT: v49 = PropGet v42 key="message"
// CHECK-NEXT: v50 = Call v47, v45, v48, v49 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v51 = Undefined
// CHECK-NEXT: Return v51
// CHECK-NEXT: }
