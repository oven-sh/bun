// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// An object under 4294967295 is read from the namespace that require answers by a pattern whose key is a number.
const h = require("./other.mjs");
const { [4294967295]: q } = h;
console.log(f(q), f([1]));
function f(v) { return Array.isArray(v) ? v.length : typeof v; }

// FILE: other.mjs
const value = { tag: 1 };
export { value as "4294967295" };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = NewClosure function=[[f_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: v8 = ModuleNamespace module=[[m_4]]
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=NotDestructurable
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = PropGet v12 key="4294967295"
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v4, -, v13 calleeName="f"
// CHECK-NEXT: v20 = Data data=[[d_5]]
// CHECK-NEXT: v21 = Call v4, -, v20 calleeName="f"
// CHECK-NEXT: v22 = Call v18, v16, v19, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] {
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
