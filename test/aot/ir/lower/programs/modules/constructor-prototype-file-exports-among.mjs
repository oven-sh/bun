// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A CommonJS file exports the object under `prototype` of a function. The function is called and constructs nowhere but through the values of the namespace object.
import * as ns from "./leaf.cjs";
console.log(
  Object.values(ns)
    .map(v => (typeof v === "function" ? v() + typeof new v() : "-"))
    .join(),
);

// FILE: leaf.cjs
function F() {
  return "called";
}
F.prototype.x = 1;
module.exports = F.prototype;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectValues
// CHECK-NEXT: v7 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeName="Object.values"
// CHECK-NEXT: v9 = PropGet v8 key="map"
// CHECK-NEXT: v10 = NewClosure function=[[f_2]]
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="map" calleeName="map"
// CHECK-NEXT: v12 = PropGet v11 key="join"
// CHECK-NEXT: v13 = Call v12, v11 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Call v4, v2, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Call v3 calleeName="v"
// CHECK-NEXT: v5 = Construct v3 calleeName="v"
// CHECK-NEXT: v6 = TypeOf v5
// CHECK-NEXT: v7 = Add v4, v6
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = String string="-"
// CHECK-NEXT: Jump -> next b3(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
