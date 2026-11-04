// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
// An object under Infinity is read from a namespace behind a star by the pattern of a parameter.
import * as h from "./between.mjs";
const q = take(h);
function take({ "Infinity": found }) { return found; }
console.log(f(q), f([1]));
function f(v) { return Array.isArray(v) ? v.length : typeof v; }

// FILE: between.mjs
export * from "./other.mjs";

// FILE: other.mjs
const value = { tag: 1 };
export { value as "Infinity" };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_2]] flags=[IsFromCompiler]}
// CHECK-NEXT: v4 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v5 = Call v1, -, v4 calleeName="take"
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v3, -, v5 calleeName="f"
// CHECK-NEXT: v12 = Data data=[[d_4]]
// CHECK-NEXT: v13 = Call v3, -, v12 calleeName="f"
// CHECK-NEXT: v14 = Call v10, v8, v11, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="take"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_5]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="Infinity"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = PropGet v4 key="Infinity"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v2 = TypeTest v0 testedType=Array
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByTest v0, v4
// CHECK-NEXT: v6 = Builtin builtin=Array
// CHECK-NEXT: v7 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v8 = Call v7, v6, v5 calleeName="Array.isArray"
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b3(v4), notTaken b4(| 0)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: v11 = NarrowByTest v0, v10
// CHECK-NEXT: v12 = PropGet v11 key="length"
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = TypeOf v5
// CHECK-NEXT: Jump -> next b5(v14)
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
