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
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = ToBoolean v6
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = String string=" | "
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = String string=""
// CHECK-NEXT: Jump -> next b5(v14)
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: v16 = Builtin builtin=String
// CHECK-NEXT: v17 = ElemGet v0, v6
// CHECK-NEXT: v18 = Call v16, -, v17 calleeName="String"
// CHECK-NEXT: v19 = Add v15, v18
// CHECK-NEXT: v20 = Add v5, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v22 = Increment v6
// CHECK-NEXT: v23 = Convert v22 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v21, v23)
// CHECK-NEXT: b6():
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="console" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="log"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v28, v26, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
