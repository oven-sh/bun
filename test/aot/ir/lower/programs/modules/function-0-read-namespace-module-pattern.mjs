// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.mjs
// A function under 0 is read from the namespace of the module itself by a pattern.
import * as h from "./main.mjs";
const value = function () { return 1; };
export { value as "0" };
const { "0": q } = h;
console.log(g(q), g(() => 2));
function g(v) { return typeof v === "function" ? v() : typeof v; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: PutModuleVariable v2 variable=[[g_3]]
// CHECK-NEXT: v4 = ModuleNamespace module=[[m_0]]
// CHECK-NEXT: v5 = TypeTest v4 testedType=undefined|null
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=NotDestructurable name="0"
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = ElemGet v8, v9
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v1, -, v10 calleeName="g"
// CHECK-NEXT: v17 = NewClosure function=[[f_4]]
// CHECK-NEXT: v18 = Call v1, -, v17 calleeName="g"
// CHECK-NEXT: v19 = Call v15, v13, v16, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Call v3 calleeName="v"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = NarrowByTest v0, v5
// CHECK-NEXT: v7 = TypeOf v6
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} text={{*}} thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
