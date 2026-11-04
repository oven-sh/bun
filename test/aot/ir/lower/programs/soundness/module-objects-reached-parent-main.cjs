// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// A required module takes the module object of its parent and of the entry point and changes what they export.
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
exports.byParent = 1;
exports.byMain = 1;
exports.byProcess = 1;
exports.f = function (x) { return typeof x; };
const log = require("./child.cjs");
show("1", typeof exports.byParent, typeof exports.byMain, typeof exports.byProcess, log.join());

// FILE: child.cjs
const log = [];
const parent = module.parent; parent.exports.byParent = "s"; log.push(parent.exports.f(1));
const main = require.main; main.exports.byMain = "s"; log.push(main.exports.f("s"));
const fromProcess = process.mainModule; fromProcess.exports.byProcess = "s"; log.push(fromProcess.exports.f());
module.exports = log;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasRestParameter, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Less v6, v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b11(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = ToBoolean v11
// CHECK-NEXT: Branch v12 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v13):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v14 = String string=" | "
// CHECK-NEXT: Jump -> next b9(v14, v13)
// CHECK-NEXT: b7(v15):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v16 = String string=""
// CHECK-NEXT: Jump -> next b9(v16, v15)
// CHECK-NEXT: b9(v17, v18):
// CHECK-NEXT: v19 = Builtin builtin=String
// CHECK-NEXT: v20 = ElemGet v0, v18
// CHECK-NEXT: v21 = Call v19, -, v20 calleeName="String"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v23 = Add v17, v22
// CHECK-NEXT: v24 = Add v5, v23
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v26 = Increment v18
// CHECK-NEXT: v27 = Convert v26 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v25, v27)
// CHECK-NEXT: b11(v28):
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v33, v31, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
