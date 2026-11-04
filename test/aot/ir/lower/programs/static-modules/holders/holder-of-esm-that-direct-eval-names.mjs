// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
// A constant that holds what import.meta.require() gave is named by the text of a direct eval: it holds the namespace object, not a stand-in.
const a = import.meta.require("./es.mjs");
console.log(eval("a.x"), typeof eval("a"));
const b = import.meta.require("./m.cjs");
console.log(eval("b.x"), typeof eval("b"));
function f() {
  const c = import.meta.require("./es.mjs");
  return eval("typeof c + c.x");
}
console.log(f());

// FILE: es.mjs
export const x = 4;

// FILE: m.cjs
exports.x = 5;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: f
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v8 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="eval" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="typeof c + c.x"
// CHECK-NEXT: v13 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v14 = StrictEq v11, v13
// CHECK-NEXT: Branch v14 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: v15 = DirectEval v12, v0, v1, v8, v4 evalScope=e2
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: v17 = Call v16, -, v12 calleeName="eval"
// CHECK-NEXT: Jump -> next b3(v17)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
