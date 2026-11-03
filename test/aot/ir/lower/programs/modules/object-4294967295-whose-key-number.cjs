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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = NewClosure function=[[f_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: v8 = ModuleNamespace module=[[m_4]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined|null
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v12 = NewRuntimeError runtimeError=NotDestructurable
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = PropGet v13 key="4294967295"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v4, -, v15 calleeName="f"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: v23 = Data data=[[d_6]]
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v25 = Call v4, -, v24 calleeName="f"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v20, v18, v22, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Array
// CHECK-NEXT: v2 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Array.isArray"
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = PropGet v0 key="length"
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v10 = TypeOf v0
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
