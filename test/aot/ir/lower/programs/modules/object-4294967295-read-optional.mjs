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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Promise<undefined|null|object> flags=[IsExpected]}
// CHECK-NEXT: v4 = Await v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = TypeTest v5 testedType=undefined|null
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Jump -> next b5(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = PropGet v9 key="4294967295"
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v1, -, v12 calleeName="f"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: v20 = Data data=[[d_4]]
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v1, -, v21 calleeName="f"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: v24 = Call v17, v15, v19, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] {
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
