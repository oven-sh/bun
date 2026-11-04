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
// CHECK-NEXT: v10 = Builtin builtin=Object
// CHECK-NEXT: v11 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v12 = Call v11, v10, v4 calleeName="Object.keys"
// CHECK-NEXT: v13 = PropGet v12 key="join"
// CHECK-NEXT: v14 = Call v13, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: v15 = PropGet v4 key="a"
// CHECK-NEXT: v16 = PropGet v4 key="early"
// CHECK-NEXT: v17 = PropGet v4 key="late"
// CHECK-NEXT: v18 = Call v9, v7, v14, v15, v16, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="console" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="log"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v20 key="a"
// CHECK-NEXT: v27 = PropGet v20 key="b"
// CHECK-NEXT: v28 = PropGet v20 key="c"
// CHECK-NEXT: v29 = PropGet v20 key="read"
// CHECK-NEXT: v30 = Call v29, v20 calleeKey="read" calleeName="below.read"
// CHECK-NEXT: v31 = Call v25, v23, v26, v27, v28, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
