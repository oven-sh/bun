// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// A store that runs before `module.exports = { .. }` lands on the first object.
const m = require("./module.cjs");
console.log(Object.keys(m).join(), m.a, m.early, m.late);
const below = require("./below.cjs");
console.log(below.a, below.b, below.c, below.read());

// FILE: below.cjs
const early = [set("early"), read()].join("|");
module.exports = { a: 2, read };
module.exports.c = early;
function set(name) { module.exports.b = name; return module.exports.b; }
function read() { return [module.exports.a, module.exports.b].join(); }

// FILE: module.cjs
function set(name) { module.exports[name === "early" ? "early" : "late"] = name; module.exports.a = name; }
set("early");
module.exports = { a: 2 };
set("late");

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
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = Builtin builtin=Object
// CHECK-NEXT: v12 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v13 = Call v12, v11, v5 calleeName="Object.keys"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="join"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v16, v14 calleeKey="join" calleeName="join"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v5 key="a"
// CHECK-NEXT: v20 = Convert v19 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v5 key="early"
// CHECK-NEXT: v22 = PropGet v5 key="late"
// CHECK-NEXT: v23 = Call v10, v8, v18, v20, v21, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: EvaluateModule module=[[m_7]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v27 = Builtin builtin=GlobalThis
// CHECK-NEXT: v28 = PropGet v27 key="console" [isFreeName]
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="log"
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v26 key="a"
// CHECK-NEXT: v33 = Convert v32 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v34 = PropGet v26 key="b"
// CHECK-NEXT: v35 = PropGet v26 key="c"
// CHECK-NEXT: v36 = PropGet v26 key="read"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v38 = Call v37, v26 calleeKey="read" calleeName="below.read"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v40 = Call v31, v29, v33, v34, v35, v39 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v41 = Undefined
// CHECK-NEXT: Return v41
// CHECK-NEXT: }
