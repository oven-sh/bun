// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// An object under 4294967295 is read from the namespace of an import call by optional brackets.
const h = await import("./other.mjs");
const q = h?.["4294967295"];
console.log(f(q), f([1]));
function f(v) { return Array.isArray(v) ? v.length : typeof v; }

// FILE: other.mjs
const value = { tag: 1 };
export { value as "4294967295" };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v3 = Await v2
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined|null
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = PropGet v7 key="4294967295"
// CHECK-NEXT: Jump -> next b3(v8)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v1, -, v9 calleeName="f"
// CHECK-NEXT: v16 = Data data=[[d_3]]
// CHECK-NEXT: v17 = Call v1, -, v16 calleeName="f"
// CHECK-NEXT: v18 = Call v14, v12, v15, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
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
