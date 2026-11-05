// One name declared with `export` and without: TS2395 to TypeScript, a type error, which is not reported. There is one variable, as in what Bun's
// transpiler prints: the second declaration takes what the variable holds and makes an object only where it holds nothing.
// Inside a namespace an exported second declaration asks the namespace's object instead, where a first one without `export` is not: `K = Outer.K ||= {}`.
// What lies inside such a name lies in two tables: `A.B` of the block with `export` and `A.B` of the block without are one object too.
// The last file has no error: each block of a namespace has a scope of its own, and what both export is one object.
// RUN: link

// FILE: main.ts
import "pkg/first-exported.ts";
import "pkg/second-exported.ts";
import "pkg/enums.ts";
import "pkg/inside-a-namespace.ts";
import "pkg/dotted.ts";
import "pkg/two-blocks.ts";

// FILE: package.json
{"name":"app"}

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"typeRoots":["./no-types-here"],"skipLibCheck":true,"allowImportingTsExtensions":true,"noEmit":true}}

// FILE: node_modules/pkg/package.json
{"name":"pkg","sideEffects":true}

// FILE: node_modules/pkg/first-exported.ts
export class K {}
namespace K { export const first = 1; }

// FILE: node_modules/pkg/second-exported.ts
class K {}
export namespace K { export const second = 2; }

// FILE: node_modules/pkg/enums.ts
export enum K { one = 1 }
enum K { two = 2 }
globalThis.seen = K;

// FILE: node_modules/pkg/inside-a-namespace.ts
export namespace Outer {
  class K {}
  export namespace K { export const inside = 3; }
}

// FILE: node_modules/pkg/dotted.ts
export namespace A.B { export const s = 1; }
namespace A.B { export const t = 2; }

// FILE: node_modules/pkg/two-blocks.ts
export namespace Outer { export enum K { one = 1 } }
export namespace Outer { export enum K { two = 2 } }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_1]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_2]]
// CHECK-NEXT: v1 = NewClass v0 layout=[[L_3]]
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_4]]
// CHECK-NEXT: v3 = FinishClass v1 layout=[[L_3]]
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: Jump -> next b3(v5, v3)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = NewObject layout=[[L_5]]
// CHECK-NEXT: v8 = FinishObject v7
// CHECK-NEXT: Jump -> next b3(v8, v8)
// CHECK-NEXT: b3(v9, v10):
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = Convert v11 declared={type=1}
// CHECK-NEXT: PropSet v10, v12 key="first"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_1]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_6]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_7]]
// CHECK-NEXT: v1 = NewClass v0 layout=[[L_8]]
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_9]]
// CHECK-NEXT: v3 = FinishClass v1 layout=[[L_8]]
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: Jump -> next b3(v5, v3)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = NewObject layout=[[L_10]]
// CHECK-NEXT: v8 = FinishObject v7
// CHECK-NEXT: Jump -> next b3(v8, v8)
// CHECK-NEXT: b3(v9, v10):
// CHECK-NEXT: v11 = Integer integer=2
// CHECK-NEXT: v12 = Convert v11 declared={type=2}
// CHECK-NEXT: PropSet v10, v12 key="second"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_6]] position={{*}} text={end=10} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_11]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: Jump -> next b3(v2, v0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: v4 = NewObject layout=[[L_12]]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: Jump -> next b3(v5, v5)
// CHECK-NEXT: b3(v6, v7):
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: PropSet v6, v8 key="one"
// CHECK-NEXT: v10 = String string="one"
// CHECK-NEXT: ElemSet v6, v8, v10
// CHECK-NEXT: v12 = ToBoolean v7
// CHECK-NEXT: Branch v12 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Jump -> next b6(v13, v7)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = NewObject layout=[[L_12]]
// CHECK-NEXT: v16 = FinishObject v15
// CHECK-NEXT: Jump -> next b6(v16, v16)
// CHECK-NEXT: b6(v17, v18):
// CHECK-NEXT: v19 = Integer integer=2
// CHECK-NEXT: PropSet v17, v19 key="two"
// CHECK-NEXT: v21 = String string="two"
// CHECK-NEXT: ElemSet v17, v19, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="globalThis" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: PropSet v25, v18 key="seen"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_13]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = NewObject layout=[[L_14]]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: v3 = NewClosure function=[[f_15]]
// CHECK-NEXT: v4 = NewClass v3 layout=[[L_16]]
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_17]]
// CHECK-NEXT: v6 = FinishClass v4 layout=[[L_16]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[f_15]] flags=[IsFromCompiler]}
// CHECK-NEXT: v8 = PropGet v2 key="K"
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: Jump -> next b3(v10)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: v12 = NewObject layout=[[L_18]]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: PropSet v2, v13 key="K"
// CHECK-NEXT: Jump -> next b3(v13)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: v16 = Integer integer=3
// CHECK-NEXT: v17 = Convert v16 declared={type=3}
// CHECK-NEXT: PropSet v15, v17 key="inside"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_13]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_16]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_16]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_16]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_19]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: Jump -> next b3(v2, v0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: v4 = NewObject layout=[[L_20]]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: Jump -> next b3(v5, v5)
// CHECK-NEXT: b3(v6, v7):
// CHECK-NEXT: v8 = PropGet v7 key="B"
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = NewObject layout=[[L_21]]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: PropSet v7, v13 key="B"
// CHECK-NEXT: Jump -> next b6(v13)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: v17 = Convert v16 declared={type=1}
// CHECK-NEXT: PropSet v15, v17 key="s"
// CHECK-NEXT: v19 = ToBoolean v7
// CHECK-NEXT: Branch v19 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: Jump -> next b9(v20, v7)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: v22 = NewObject layout=[[L_20]]
// CHECK-NEXT: v23 = FinishObject v22
// CHECK-NEXT: Jump -> next b9(v23, v23)
// CHECK-NEXT: b9(v24, v25):
// CHECK-NEXT: v26 = PropGet v25 key="B"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v28):
// CHECK-NEXT: Jump -> next b12(v28)
// CHECK-NEXT: b11(v29):
// CHECK-NEXT: v30 = NewObject layout=[[L_22]]
// CHECK-NEXT: v31 = FinishObject v30
// CHECK-NEXT: PropSet v25, v31 key="B"
// CHECK-NEXT: Jump -> next b12(v31)
// CHECK-NEXT: b12(v33):
// CHECK-NEXT: v34 = Integer integer=2
// CHECK-NEXT: v35 = Convert v34 declared={type=2}
// CHECK-NEXT: PropSet v33, v35 key="t"
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_23]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: Jump -> next b3(v2, v0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: v4 = NewObject layout=[[L_24]]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: Jump -> next b3(v5, v5)
// CHECK-NEXT: b3(v6, v7):
// CHECK-NEXT: v8 = PropGet v7 key="K"
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = NewObject layout=[[L_25]]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: PropSet v7, v13 key="K"
// CHECK-NEXT: Jump -> next b6(v13)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: PropSet v15, v16 key="one"
// CHECK-NEXT: v18 = String string="one"
// CHECK-NEXT: ElemSet v15, v16, v18
// CHECK-NEXT: v20 = ToBoolean v7
// CHECK-NEXT: Branch v20 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: Jump -> next b9(v21, v7)
// CHECK-NEXT: b8(v22):
// CHECK-NEXT: v23 = NewObject layout=[[L_24]]
// CHECK-NEXT: v24 = FinishObject v23
// CHECK-NEXT: Jump -> next b9(v24, v24)
// CHECK-NEXT: b9(v25, v26):
// CHECK-NEXT: v27 = PropGet v26 key="K"
// CHECK-NEXT: v28 = ToBoolean v27
// CHECK-NEXT: Branch v28 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v29):
// CHECK-NEXT: Jump -> next b12(v29)
// CHECK-NEXT: b11(v30):
// CHECK-NEXT: v31 = NewObject layout=[[L_25]]
// CHECK-NEXT: v32 = FinishObject v31
// CHECK-NEXT: PropSet v26, v32 key="K"
// CHECK-NEXT: Jump -> next b12(v32)
// CHECK-NEXT: b12(v34):
// CHECK-NEXT: v35 = Integer integer=2
// CHECK-NEXT: PropSet v34, v35 key="two"
// CHECK-NEXT: v37 = String string="two"
// CHECK-NEXT: ElemSet v34, v35, v37
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="firstSearchedIndex"
// CHECK: module=[[m_26]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|number}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|number, v1: number):
// CHECK-NEXT: v2 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = NarrowByTest v0, v6
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = GreaterEq v7, v8
// CHECK-NEXT: Branch v9 -> taken b3(), notTaken b7()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Less v7, v1
// CHECK-NEXT: Branch v10 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b6(v1)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = URShift v11, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=number}
// CHECK-NEXT: Return v14
// CHECK-NEXT: b7():
// CHECK-NEXT: v15 = Negate v7
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: v17 = GreaterEq v15, v16
// CHECK-NEXT: Branch v17 -> taken b8(), notTaken b10()
// CHECK-NEXT: b8():
// CHECK-NEXT: v18 = Less v15, v1
// CHECK-NEXT: Branch v18 -> taken b9(), notTaken b10()
// CHECK-NEXT: b9():
// CHECK-NEXT: v19 = Integer
// CHECK-NEXT: v20 = URShift v15, v19
// CHECK-NEXT: v21 = Sub v1, v20
// CHECK-NEXT: v22 = Integer
// CHECK-NEXT: v23 = URShift v21, v22
// CHECK-NEXT: Jump -> next b11(v23)
// CHECK-NEXT: b10():
// CHECK-NEXT: v24 = Integer
// CHECK-NEXT: Jump -> next b11(v24)
// CHECK-NEXT: b11(v25):
// CHECK-NEXT: v26 = Convert v25 declared={type=number}
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="holdsBoxedValues"
// CHECK: module=[[m_26]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=3
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = StrictEq v0, v6
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: v9 = Convert v8 declared={type=boolean}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="indexOfUndefined"
// CHECK: module=[[m_26]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: number):
// CHECK-NEXT: Jump -> next b1(v1)
// CHECK-NEXT: b1(v3: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = Less v3, v2
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b8()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v7 = Convert v3 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v8 = HasContiguousIndex v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=boolean}
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v13 = Convert v3 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v14 = GetContiguousIndex v12, v13
// CHECK-NEXT: v15 = TypeTest v14 testedType=undefined
// CHECK-NEXT: Branch v15 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: v17 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v17
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v20 = Increment v3
// CHECK-NEXT: v21 = Convert v20 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v21)
// CHECK-NEXT: b8():
// CHECK-NEXT: v22 = Integer integer=-1
// CHECK-NEXT: v23 = Convert v22 declared={type=number}
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="indexOf"
// CHECK: module=[[m_26]] position={{*}} text={{*}} kind=Method role=Library flags=[HasThis, IsChecked, HasExplicitName] length=2 enclosingRuntimeFunction=ArraySearchIndexOf thisType={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} parameters=[{type=anything}, {type=undefined|number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything, v2: undefined|number):
// CHECK-NEXT: v3 = PropGet v0 key="length"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = URShift v3, v4
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_27]]
// CHECK-NEXT: v7 = Call v6, -, v2, v5 calleeName="firstSearchedIndex"
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: v9 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v10 = ArrayStorageKind v9
// CHECK-NEXT: v11 = Integer integer=2
// CHECK-NEXT: v12 = StrictEq v10, v11
// CHECK-NEXT: Branch v12 -> taken b1(), notTaken b9()
// CHECK-NEXT: b1():
// CHECK-NEXT: v13 = TypeTest v1 testedType=number
// CHECK-NEXT: Branch v13 -> taken b2(| 0), notTaken b8(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: v15 = NarrowByTest v1, v14
// CHECK-NEXT: Jump -> next b3(v8)
// CHECK-NEXT: b3(v16: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v18 = Less v16, v5
// CHECK-NEXT: Branch v18 -> taken b4(), notTaken b7()
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v20 = Convert v16 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v21 = GetDoubleIndex v19, v20
// CHECK-NEXT: v22 = StrictEq v21, v15
// CHECK-NEXT: Branch v22 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v23 = Convert v16 declared={type=number}
// CHECK-NEXT: Return v23
// CHECK-NEXT: b6():
// CHECK-NEXT: v24 = Increment v16
// CHECK-NEXT: v25 = Convert v24 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v25)
// CHECK-NEXT: b7():
// CHECK-NEXT: v26 = Integer integer=-1
// CHECK-NEXT: v27 = Convert v26 declared={type=number}
// CHECK-NEXT: Return v27
// CHECK-NEXT: b8(v28):
// CHECK-NEXT: v29 = Integer integer=-1
// CHECK-NEXT: v30 = Convert v29 declared={type=number}
// CHECK-NEXT: Return v30
// CHECK-NEXT: b9():
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_28]]
// CHECK-NEXT: v32 = Call v31, -, v10 calleeName="holdsBoxedValues"
// CHECK-NEXT: v33 = ToBoolean v32
// CHECK-NEXT: Branch v33 -> taken b10(| 0), notTaken b18(| 0)
// CHECK-NEXT: b10(v34):
// CHECK-NEXT: v35 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v35 -> taken b11(| 0), notTaken b12(| 0)
// CHECK-NEXT: b11(v36):
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_29]]
// CHECK-NEXT: v38 = Call v37, -, v0, v8, v5 calleeName="indexOfUndefined"
// CHECK-NEXT: ReturnCall v38 casts=[{declared={type=number}}]
// CHECK-NEXT: b12(v39):
// CHECK-NEXT: v40 = NarrowByTest v1, v39
// CHECK-NEXT: Jump -> next b13(v8)
// CHECK-NEXT: b13(v41: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v43 = Less v41, v5
// CHECK-NEXT: Branch v43 -> taken b14(), notTaken b17()
// CHECK-NEXT: b14():
// CHECK-NEXT: v44 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v45 = Convert v41 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v46 = GetContiguousIndex v44, v45
// CHECK-NEXT: v47 = StrictEq v46, v40
// CHECK-NEXT: Branch v47 -> taken b15(), notTaken b16()
// CHECK-NEXT: b15():
// CHECK-NEXT: v48 = Convert v41 declared={type=number}
// CHECK-NEXT: Return v48
// CHECK-NEXT: b16():
// CHECK-NEXT: v49 = Increment v41
// CHECK-NEXT: v50 = Convert v49 declared={type=number}
// CHECK-NEXT: Jump -> next b13(v50)
// CHECK-NEXT: b17():
// CHECK-NEXT: v51 = Integer integer=-1
// CHECK-NEXT: v52 = Convert v51 declared={type=number}
// CHECK-NEXT: Return v52
// CHECK-NEXT: b18(v53):
// CHECK-NEXT: Jump -> next b19(v8)
// CHECK-NEXT: b19(v54: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v56 = Less v54, v5
// CHECK-NEXT: Branch v56 -> taken b20(), notTaken b25()
// CHECK-NEXT: b20():
// CHECK-NEXT: v57 = ElemHas v0, v54
// CHECK-NEXT: v58 = ToBoolean v57
// CHECK-NEXT: Branch v58 -> taken b21(| 0), notTaken b23(| 0)
// CHECK-NEXT: b21(v59):
// CHECK-NEXT: v60 = ElemGet v0, v54
// CHECK-NEXT: v61 = StrictEq v60, v1
// CHECK-NEXT: Branch v61 -> taken b22(), notTaken b24()
// CHECK-NEXT: b22():
// CHECK-NEXT: v62 = Convert v54 declared={type=number}
// CHECK-NEXT: Return v62
// CHECK-NEXT: b23(v63):
// CHECK-NEXT: Jump -> next b24()
// CHECK-NEXT: b24():
// CHECK-NEXT: v64 = Increment v54
// CHECK-NEXT: v65 = Convert v64 declared={type=number}
// CHECK-NEXT: Jump -> next b19(v65)
// CHECK-NEXT: b25():
// CHECK-NEXT: v66 = Integer integer=-1
// CHECK-NEXT: v67 = Convert v66 declared={type=number}
// CHECK-NEXT: Return v67
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="includesNaN"
// CHECK: module=[[m_26]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: number):
// CHECK-NEXT: Jump -> next b1(v1)
// CHECK-NEXT: b1(v3: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = Less v3, v2
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = ElemGet v0, v3
// CHECK-NEXT: v7 = StrictEq v6, v6
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Increment v3
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v9)
// CHECK-NEXT: b4():
// CHECK-NEXT: v10 = Boolean boolean=true
// CHECK-NEXT: v11 = Convert v10 declared={type=boolean}
// CHECK-NEXT: Return v11
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = Boolean
// CHECK-NEXT: v13 = Convert v12 declared={type=boolean}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="includes"
// CHECK: module=[[m_26]] position={{*}} text={{*}} kind=Method role=Library flags=[HasThis, IsChecked, HasExplicitName] length=2 enclosingRuntimeFunction=ArraySearchIncludes thisType={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} parameters=[{type=anything}, {type=undefined|number}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything, v2: undefined|number):
// CHECK-NEXT: v3 = PropGet v0 key="length"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = URShift v3, v4
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_27]]
// CHECK-NEXT: v7 = Call v6, -, v2, v5 calleeName="firstSearchedIndex"
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: v9 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v10 = ArrayStorageKind v9
// CHECK-NEXT: v11 = Integer integer=2
// CHECK-NEXT: v12 = StrictEq v10, v11
// CHECK-NEXT: Branch v12 -> taken b1(), notTaken b16()
// CHECK-NEXT: b1():
// CHECK-NEXT: v13 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v13 -> taken b2(| 0), notTaken b8(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: Jump -> next b3(v8)
// CHECK-NEXT: b3(v15: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v17 = Less v15, v5
// CHECK-NEXT: Branch v17 -> taken b4(), notTaken b7()
// CHECK-NEXT: b4():
// CHECK-NEXT: v18 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v19 = Convert v15 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v20 = GetDoubleIndex v18, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=number}
// CHECK-NEXT: v22 = StrictEq v21, v21
// CHECK-NEXT: Branch v22 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v23 = Increment v15
// CHECK-NEXT: v24 = Convert v23 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v24)
// CHECK-NEXT: b6():
// CHECK-NEXT: v25 = Boolean boolean=true
// CHECK-NEXT: v26 = Convert v25 declared={type=boolean}
// CHECK-NEXT: Return v26
// CHECK-NEXT: b7():
// CHECK-NEXT: v27 = Boolean
// CHECK-NEXT: v28 = Convert v27 declared={type=boolean}
// CHECK-NEXT: Return v28
// CHECK-NEXT: b8(v29):
// CHECK-NEXT: v30 = NarrowByTest v1, v29
// CHECK-NEXT: v31 = TypeTest v30 testedType=number
// CHECK-NEXT: Branch v31 -> taken b9(| 0), notTaken b15(| 0)
// CHECK-NEXT: b9(v32):
// CHECK-NEXT: v33 = NarrowByTest v1, v32
// CHECK-NEXT: Jump -> next b10(v8)
// CHECK-NEXT: b10(v34: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v36 = Less v34, v5
// CHECK-NEXT: Branch v36 -> taken b11(), notTaken b14()
// CHECK-NEXT: b11():
// CHECK-NEXT: v37 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v38 = Convert v34 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v39 = GetDoubleIndex v37, v38
// CHECK-NEXT: v40 = StrictEq v39, v33
// CHECK-NEXT: Branch v40 -> taken b12(), notTaken b13()
// CHECK-NEXT: b12():
// CHECK-NEXT: v41 = Boolean boolean=true
// CHECK-NEXT: v42 = Convert v41 declared={type=boolean}
// CHECK-NEXT: Return v42
// CHECK-NEXT: b13():
// CHECK-NEXT: v43 = Increment v34
// CHECK-NEXT: v44 = Convert v43 declared={type=number}
// CHECK-NEXT: Jump -> next b10(v44)
// CHECK-NEXT: b14():
// CHECK-NEXT: v45 = Boolean
// CHECK-NEXT: v46 = Convert v45 declared={type=boolean}
// CHECK-NEXT: Return v46
// CHECK-NEXT: b15(v47):
// CHECK-NEXT: v48 = Boolean
// CHECK-NEXT: v49 = Convert v48 declared={type=boolean}
// CHECK-NEXT: Return v49
// CHECK-NEXT: b16():
// CHECK-NEXT: v50 = StrictEq v1, v1
// CHECK-NEXT: Branch v50 -> taken b17(), notTaken b30()
// CHECK-NEXT: b17():
// CHECK-NEXT: v51 = GetModuleVariable variable=[[g_28]]
// CHECK-NEXT: v52 = Call v51, -, v10 calleeName="holdsBoxedValues"
// CHECK-NEXT: v53 = ToBoolean v52
// CHECK-NEXT: Branch v53 -> taken b18(| 0), notTaken b24(| 0)
// CHECK-NEXT: b18(v54):
// CHECK-NEXT: Jump -> next b19(v8)
// CHECK-NEXT: b19(v55: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v57 = Less v55, v5
// CHECK-NEXT: Branch v57 -> taken b20(), notTaken b23()
// CHECK-NEXT: b20():
// CHECK-NEXT: v58 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v59 = Convert v55 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v60 = GetContiguousIndex v58, v59
// CHECK-NEXT: v61 = StrictEq v60, v1
// CHECK-NEXT: Branch v61 -> taken b21(), notTaken b22()
// CHECK-NEXT: b21():
// CHECK-NEXT: v62 = Boolean boolean=true
// CHECK-NEXT: v63 = Convert v62 declared={type=boolean}
// CHECK-NEXT: Return v63
// CHECK-NEXT: b22():
// CHECK-NEXT: v64 = Increment v55
// CHECK-NEXT: v65 = Convert v64 declared={type=number}
// CHECK-NEXT: Jump -> next b19(v65)
// CHECK-NEXT: b23():
// CHECK-NEXT: v66 = Boolean
// CHECK-NEXT: v67 = Convert v66 declared={type=boolean}
// CHECK-NEXT: Return v67
// CHECK-NEXT: b24(v68):
// CHECK-NEXT: Jump -> next b25(v8)
// CHECK-NEXT: b25(v69: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v71 = Less v69, v5
// CHECK-NEXT: Branch v71 -> taken b26(), notTaken b29()
// CHECK-NEXT: b26():
// CHECK-NEXT: v72 = ElemGet v0, v69
// CHECK-NEXT: v73 = StrictEq v72, v1
// CHECK-NEXT: Branch v73 -> taken b27(), notTaken b28()
// CHECK-NEXT: b27():
// CHECK-NEXT: v74 = Boolean boolean=true
// CHECK-NEXT: v75 = Convert v74 declared={type=boolean}
// CHECK-NEXT: Return v75
// CHECK-NEXT: b28():
// CHECK-NEXT: v76 = Increment v69
// CHECK-NEXT: v77 = Convert v76 declared={type=number}
// CHECK-NEXT: Jump -> next b25(v77)
// CHECK-NEXT: b29():
// CHECK-NEXT: v78 = Boolean
// CHECK-NEXT: v79 = Convert v78 declared={type=boolean}
// CHECK-NEXT: Return v79
// CHECK-NEXT: b30():
// CHECK-NEXT: v80 = Integer integer=1
// CHECK-NEXT: v81 = StrictEq v10, v80
// CHECK-NEXT: v82 = LogicalNot v81
// CHECK-NEXT: v83 = ToBoolean v82
// CHECK-NEXT: Branch v83 -> taken b31(| 0), notTaken b32(| 0)
// CHECK-NEXT: b31(v84):
// CHECK-NEXT: v85 = GetModuleVariable variable=[[g_30]]
// CHECK-NEXT: v86 = Call v85, -, v0, v8, v5 calleeName="includesNaN"
// CHECK-NEXT: ReturnCall v86 casts=[{declared={type=boolean}}]
// CHECK-NEXT: b32(v87):
// CHECK-NEXT: v88 = Convert v87 declared={type=boolean}
// CHECK-NEXT: Return v88
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isCallable"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isDoubleArray"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v2 = ArrayStorageKind v1
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isContiguousArray"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v2 = ArrayStorageKind v1
// CHECK-NEXT: v3 = Integer integer=3
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = StrictEq v2, v8
// CHECK-NEXT: Jump -> next b3(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=boolean}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isLessThoughNoNumber"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=boolean
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: v5 = LogicalNot v4
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = NarrowByTest v0, v7
// CHECK-NEXT: v9 = ToNumber v8
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = Less v9, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=boolean}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isLess"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Less v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = NarrowByTest v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_32]]
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = Call v9, v10, v8 [isNeverInlined]
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=boolean}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="gallopLeft"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=6 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}, {type=number}, {type=anything}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|Array, v2: number, v3: number, v4: number, v5: anything):
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: v10 = Add v2, v4
// CHECK-NEXT: v11 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v12 = Convert v10 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v13 = GetOwnContiguousIndex v11, v12
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: v16 = Call v5, v15, v13, v0 [isNeverInlined]
// CHECK-NEXT: v17 = Call v14, -, v16 calleeName="isLess"
// CHECK-NEXT: v18 = ToBoolean v17
// CHECK-NEXT: Branch v18 -> taken b1(| 0), notTaken b8(| 0)
// CHECK-NEXT: b1(v19):
// CHECK-NEXT: v20 = Sub v3, v4
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: v22 = BitOr v20, v21
// CHECK-NEXT: Jump -> next b2(v7, v9)
// CHECK-NEXT: b2(v23: number, v24: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v26 = Less v24, v22
// CHECK-NEXT: Branch v26 -> taken b3(), notTaken b7()
// CHECK-NEXT: b3():
// CHECK-NEXT: v27 = Add v2, v4
// CHECK-NEXT: v28 = Add v27, v24
// CHECK-NEXT: v29 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v30 = Convert v28 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v31 = GetOwnContiguousIndex v29, v30
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: v34 = Call v5, v33, v31, v0 [isNeverInlined]
// CHECK-NEXT: v35 = Call v32, -, v34 calleeName="isLess"
// CHECK-NEXT: v36 = ToBoolean v35
// CHECK-NEXT: Branch v36 -> taken b4(| 0), notTaken b7()
// CHECK-NEXT: b4(v37):
// CHECK-NEXT: v38 = Convert v24 declared={type=number}
// CHECK-NEXT: v39 = Integer integer=2
// CHECK-NEXT: v40 = Mul v24, v39
// CHECK-NEXT: v41 = Integer integer=1
// CHECK-NEXT: v42 = Add v40, v41
// CHECK-NEXT: v43 = Integer
// CHECK-NEXT: v44 = BitOr v42, v43
// CHECK-NEXT: v45 = Convert v44 declared={type=number}
// CHECK-NEXT: v46 = Greater v45, v22
// CHECK-NEXT: Branch v46 -> taken b5(), notTaken b6(v45)
// CHECK-NEXT: b5():
// CHECK-NEXT: v47 = Convert v22 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v47)
// CHECK-NEXT: b6(v48: number):
// CHECK-NEXT: Jump -> next b2(v38, v48)
// CHECK-NEXT: b7():
// CHECK-NEXT: v49 = Add v23, v4
// CHECK-NEXT: v50 = Integer
// CHECK-NEXT: v51 = BitOr v49, v50
// CHECK-NEXT: v52 = Convert v51 declared={type=number}
// CHECK-NEXT: v53 = Add v24, v4
// CHECK-NEXT: v54 = Integer
// CHECK-NEXT: v55 = BitOr v53, v54
// CHECK-NEXT: v56 = Convert v55 declared={type=number}
// CHECK-NEXT: Jump -> next b15(v52, v56)
// CHECK-NEXT: b8(v57):
// CHECK-NEXT: v58 = Integer integer=1
// CHECK-NEXT: v59 = Add v4, v58
// CHECK-NEXT: v60 = Integer
// CHECK-NEXT: v61 = BitOr v59, v60
// CHECK-NEXT: Jump -> next b9(v7, v9)
// CHECK-NEXT: b9(v62: number, v63: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v65 = Less v63, v61
// CHECK-NEXT: Branch v65 -> taken b10(), notTaken b14()
// CHECK-NEXT: b10():
// CHECK-NEXT: v66 = Add v2, v4
// CHECK-NEXT: v67 = Sub v66, v63
// CHECK-NEXT: v68 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v69 = Convert v67 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v70 = GetOwnContiguousIndex v68, v69
// CHECK-NEXT: v71 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v72 = Undefined
// CHECK-NEXT: v73 = Call v5, v72, v70, v0 [isNeverInlined]
// CHECK-NEXT: v74 = Call v71, -, v73 calleeName="isLess"
// CHECK-NEXT: v75 = ToBoolean v74
// CHECK-NEXT: Branch v75 -> taken b14(), notTaken b11(| 0)
// CHECK-NEXT: b11(v76):
// CHECK-NEXT: v77 = Convert v63 declared={type=number}
// CHECK-NEXT: v78 = Integer integer=2
// CHECK-NEXT: v79 = Mul v63, v78
// CHECK-NEXT: v80 = Integer integer=1
// CHECK-NEXT: v81 = Add v79, v80
// CHECK-NEXT: v82 = Integer
// CHECK-NEXT: v83 = BitOr v81, v82
// CHECK-NEXT: v84 = Convert v83 declared={type=number}
// CHECK-NEXT: v85 = Greater v84, v61
// CHECK-NEXT: Branch v85 -> taken b12(), notTaken b13(v84)
// CHECK-NEXT: b12():
// CHECK-NEXT: v86 = Convert v61 declared={type=number}
// CHECK-NEXT: Jump -> next b13(v86)
// CHECK-NEXT: b13(v87: number):
// CHECK-NEXT: Jump -> next b9(v77, v87)
// CHECK-NEXT: b14():
// CHECK-NEXT: v88 = Sub v4, v63
// CHECK-NEXT: v89 = Integer
// CHECK-NEXT: v90 = BitOr v88, v89
// CHECK-NEXT: v91 = Convert v90 declared={type=number}
// CHECK-NEXT: v92 = Sub v4, v62
// CHECK-NEXT: v93 = Integer
// CHECK-NEXT: v94 = BitOr v92, v93
// CHECK-NEXT: v95 = Convert v94 declared={type=number}
// CHECK-NEXT: Jump -> next b15(v91, v95)
// CHECK-NEXT: b15(v96: number, v97: number):
// CHECK-NEXT: v98 = Integer integer=1
// CHECK-NEXT: v99 = Add v96, v98
// CHECK-NEXT: v100 = Integer
// CHECK-NEXT: v101 = BitOr v99, v100
// CHECK-NEXT: v102 = Convert v101 declared={type=number}
// CHECK-NEXT: Jump -> next b16(v102, v97)
// CHECK-NEXT: b16(v103: number, v104: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v106 = Less v103, v104
// CHECK-NEXT: Branch v106 -> taken b17(), notTaken b21()
// CHECK-NEXT: b17():
// CHECK-NEXT: v107 = Sub v104, v103
// CHECK-NEXT: v108 = Integer integer=1
// CHECK-NEXT: v109 = RShift v107, v108
// CHECK-NEXT: v110 = Add v103, v109
// CHECK-NEXT: v111 = Integer
// CHECK-NEXT: v112 = BitOr v110, v111
// CHECK-NEXT: v113 = Add v2, v112
// CHECK-NEXT: v114 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v115 = Convert v113 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v116 = GetOwnContiguousIndex v114, v115
// CHECK-NEXT: v117 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v118 = Undefined
// CHECK-NEXT: v119 = Call v5, v118, v116, v0 [isNeverInlined]
// CHECK-NEXT: v120 = Call v117, -, v119 calleeName="isLess"
// CHECK-NEXT: v121 = ToBoolean v120
// CHECK-NEXT: Branch v121 -> taken b18(| 0), notTaken b19(| 0)
// CHECK-NEXT: b18(v122):
// CHECK-NEXT: v123 = Integer integer=1
// CHECK-NEXT: v124 = Add v112, v123
// CHECK-NEXT: v125 = Integer
// CHECK-NEXT: v126 = BitOr v124, v125
// CHECK-NEXT: v127 = Convert v126 declared={type=number}
// CHECK-NEXT: Jump -> next b20(v127, v104)
// CHECK-NEXT: b19(v128):
// CHECK-NEXT: v129 = Convert v112 declared={type=number}
// CHECK-NEXT: Jump -> next b20(v103, v129)
// CHECK-NEXT: b20(v130: number, v131: number):
// CHECK-NEXT: Jump -> next b16(v130, v131)
// CHECK-NEXT: b21():
// CHECK-NEXT: v132 = Convert v104 declared={type=number}
// CHECK-NEXT: Return v132
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="gallopRight"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=6 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}, {type=number}, {type=anything}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|Array, v2: number, v3: number, v4: number, v5: anything):
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: v10 = Add v2, v4
// CHECK-NEXT: v11 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v12 = Convert v10 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v13 = GetOwnContiguousIndex v11, v12
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: v16 = Call v5, v15, v0, v13 [isNeverInlined]
// CHECK-NEXT: v17 = Call v14, -, v16 calleeName="isLess"
// CHECK-NEXT: v18 = ToBoolean v17
// CHECK-NEXT: Branch v18 -> taken b1(| 0), notTaken b8(| 0)
// CHECK-NEXT: b1(v19):
// CHECK-NEXT: v20 = Integer integer=1
// CHECK-NEXT: v21 = Add v4, v20
// CHECK-NEXT: v22 = Integer
// CHECK-NEXT: v23 = BitOr v21, v22
// CHECK-NEXT: Jump -> next b2(v7, v9)
// CHECK-NEXT: b2(v24: number, v25: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v27 = Less v25, v23
// CHECK-NEXT: Branch v27 -> taken b3(), notTaken b7()
// CHECK-NEXT: b3():
// CHECK-NEXT: v28 = Add v2, v4
// CHECK-NEXT: v29 = Sub v28, v25
// CHECK-NEXT: v30 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v31 = Convert v29 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v32 = GetOwnContiguousIndex v30, v31
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: v35 = Call v5, v34, v0, v32 [isNeverInlined]
// CHECK-NEXT: v36 = Call v33, -, v35 calleeName="isLess"
// CHECK-NEXT: v37 = ToBoolean v36
// CHECK-NEXT: Branch v37 -> taken b4(| 0), notTaken b7()
// CHECK-NEXT: b4(v38):
// CHECK-NEXT: v39 = Convert v25 declared={type=number}
// CHECK-NEXT: v40 = Integer integer=2
// CHECK-NEXT: v41 = Mul v25, v40
// CHECK-NEXT: v42 = Integer integer=1
// CHECK-NEXT: v43 = Add v41, v42
// CHECK-NEXT: v44 = Integer
// CHECK-NEXT: v45 = BitOr v43, v44
// CHECK-NEXT: v46 = Convert v45 declared={type=number}
// CHECK-NEXT: v47 = Greater v46, v23
// CHECK-NEXT: Branch v47 -> taken b5(), notTaken b6(v46)
// CHECK-NEXT: b5():
// CHECK-NEXT: v48 = Convert v23 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v48)
// CHECK-NEXT: b6(v49: number):
// CHECK-NEXT: Jump -> next b2(v39, v49)
// CHECK-NEXT: b7():
// CHECK-NEXT: v50 = Sub v4, v25
// CHECK-NEXT: v51 = Integer
// CHECK-NEXT: v52 = BitOr v50, v51
// CHECK-NEXT: v53 = Convert v52 declared={type=number}
// CHECK-NEXT: v54 = Sub v4, v24
// CHECK-NEXT: v55 = Integer
// CHECK-NEXT: v56 = BitOr v54, v55
// CHECK-NEXT: v57 = Convert v56 declared={type=number}
// CHECK-NEXT: Jump -> next b15(v53, v57)
// CHECK-NEXT: b8(v58):
// CHECK-NEXT: v59 = Sub v3, v4
// CHECK-NEXT: v60 = Integer
// CHECK-NEXT: v61 = BitOr v59, v60
// CHECK-NEXT: Jump -> next b9(v7, v9)
// CHECK-NEXT: b9(v62: number, v63: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v65 = Less v63, v61
// CHECK-NEXT: Branch v65 -> taken b10(), notTaken b14()
// CHECK-NEXT: b10():
// CHECK-NEXT: v66 = Add v2, v4
// CHECK-NEXT: v67 = Add v66, v63
// CHECK-NEXT: v68 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v69 = Convert v67 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v70 = GetOwnContiguousIndex v68, v69
// CHECK-NEXT: v71 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v72 = Undefined
// CHECK-NEXT: v73 = Call v5, v72, v0, v70 [isNeverInlined]
// CHECK-NEXT: v74 = Call v71, -, v73 calleeName="isLess"
// CHECK-NEXT: v75 = ToBoolean v74
// CHECK-NEXT: Branch v75 -> taken b14(), notTaken b11(| 0)
// CHECK-NEXT: b11(v76):
// CHECK-NEXT: v77 = Convert v63 declared={type=number}
// CHECK-NEXT: v78 = Integer integer=2
// CHECK-NEXT: v79 = Mul v63, v78
// CHECK-NEXT: v80 = Integer integer=1
// CHECK-NEXT: v81 = Add v79, v80
// CHECK-NEXT: v82 = Integer
// CHECK-NEXT: v83 = BitOr v81, v82
// CHECK-NEXT: v84 = Convert v83 declared={type=number}
// CHECK-NEXT: v85 = Greater v84, v61
// CHECK-NEXT: Branch v85 -> taken b12(), notTaken b13(v84)
// CHECK-NEXT: b12():
// CHECK-NEXT: v86 = Convert v61 declared={type=number}
// CHECK-NEXT: Jump -> next b13(v86)
// CHECK-NEXT: b13(v87: number):
// CHECK-NEXT: Jump -> next b9(v77, v87)
// CHECK-NEXT: b14():
// CHECK-NEXT: v88 = Add v62, v4
// CHECK-NEXT: v89 = Integer
// CHECK-NEXT: v90 = BitOr v88, v89
// CHECK-NEXT: v91 = Convert v90 declared={type=number}
// CHECK-NEXT: v92 = Add v63, v4
// CHECK-NEXT: v93 = Integer
// CHECK-NEXT: v94 = BitOr v92, v93
// CHECK-NEXT: v95 = Convert v94 declared={type=number}
// CHECK-NEXT: Jump -> next b15(v91, v95)
// CHECK-NEXT: b15(v96: number, v97: number):
// CHECK-NEXT: v98 = Integer integer=1
// CHECK-NEXT: v99 = Add v96, v98
// CHECK-NEXT: v100 = Integer
// CHECK-NEXT: v101 = BitOr v99, v100
// CHECK-NEXT: v102 = Convert v101 declared={type=number}
// CHECK-NEXT: Jump -> next b16(v102, v97)
// CHECK-NEXT: b16(v103: number, v104: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v106 = Less v103, v104
// CHECK-NEXT: Branch v106 -> taken b17(), notTaken b21()
// CHECK-NEXT: b17():
// CHECK-NEXT: v107 = Sub v104, v103
// CHECK-NEXT: v108 = Integer integer=1
// CHECK-NEXT: v109 = RShift v107, v108
// CHECK-NEXT: v110 = Add v103, v109
// CHECK-NEXT: v111 = Integer
// CHECK-NEXT: v112 = BitOr v110, v111
// CHECK-NEXT: v113 = Add v2, v112
// CHECK-NEXT: v114 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v115 = Convert v113 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v116 = GetOwnContiguousIndex v114, v115
// CHECK-NEXT: v117 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v118 = Undefined
// CHECK-NEXT: v119 = Call v5, v118, v0, v116 [isNeverInlined]
// CHECK-NEXT: v120 = Call v117, -, v119 calleeName="isLess"
// CHECK-NEXT: v121 = ToBoolean v120
// CHECK-NEXT: Branch v121 -> taken b18(| 0), notTaken b19(| 0)
// CHECK-NEXT: b18(v122):
// CHECK-NEXT: v123 = Convert v112 declared={type=number}
// CHECK-NEXT: Jump -> next b20(v103, v123)
// CHECK-NEXT: b19(v124):
// CHECK-NEXT: v125 = Integer integer=1
// CHECK-NEXT: v126 = Add v112, v125
// CHECK-NEXT: v127 = Integer
// CHECK-NEXT: v128 = BitOr v126, v127
// CHECK-NEXT: v129 = Convert v128 declared={type=number}
// CHECK-NEXT: Jump -> next b20(v129, v104)
// CHECK-NEXT: b20(v130: number, v131: number):
// CHECK-NEXT: Jump -> next b16(v130, v131)
// CHECK-NEXT: b21():
// CHECK-NEXT: v132 = Convert v104 declared={type=number}
// CHECK-NEXT: Return v132
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="computeRunPower"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=number}, {type=number}, {type=number}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number, v1: number, v2: number, v3: number):
// CHECK-NEXT: v4 = Add v0, v1
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: v6 = Add v1, v2
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = Convert v10 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v5, v9, v11)
// CHECK-NEXT: b1(v12: number, v13: number, v14: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = GreaterEq v12, v3
// CHECK-NEXT: v17 = GreaterEq v13, v3
// CHECK-NEXT: v18 = StrictEq v16, v17
// CHECK-NEXT: Branch v18 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v19 = GreaterEq v12, v3
// CHECK-NEXT: Branch v19 -> taken b3(), notTaken b4(v12, v13)
// CHECK-NEXT: b3():
// CHECK-NEXT: v20 = Sub v12, v3
// CHECK-NEXT: v21 = Convert v20 declared={type=number}
// CHECK-NEXT: v22 = Sub v13, v3
// CHECK-NEXT: v23 = Convert v22 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v21, v23)
// CHECK-NEXT: b4(v24: number, v25: number):
// CHECK-NEXT: v26 = Integer integer=2
// CHECK-NEXT: v27 = Mul v24, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=number}
// CHECK-NEXT: v29 = Integer integer=2
// CHECK-NEXT: v30 = Mul v25, v29
// CHECK-NEXT: v31 = Convert v30 declared={type=number}
// CHECK-NEXT: v32 = Integer integer=1
// CHECK-NEXT: v33 = Add v14, v32
// CHECK-NEXT: v34 = Integer
// CHECK-NEXT: v35 = BitOr v33, v34
// CHECK-NEXT: v36 = Convert v35 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v28, v31, v36)
// CHECK-NEXT: b5():
// CHECK-NEXT: v37 = Convert v14 declared={type=number}
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="extendValueRun"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}, {type=anything}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: number, v3: anything):
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = BitOr v1, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = BitOr v2, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v6)
// CHECK-NEXT: b1(v10: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Add v10, v12
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = BitOr v13, v14
// CHECK-NEXT: v16 = Less v15, v9
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = Integer integer=1
// CHECK-NEXT: v18 = Add v10, v17
// CHECK-NEXT: v19 = Integer
// CHECK-NEXT: v20 = BitOr v18, v19
// CHECK-NEXT: v21 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v22 = Convert v20 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v23 = GetOwnContiguousIndex v21, v22
// CHECK-NEXT: v24 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v25 = Convert v10 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v26 = GetOwnContiguousIndex v24, v25
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: v29 = Call v3, v28, v23, v26
// CHECK-NEXT: v30 = Call v27, -, v29 calleeName="isLess"
// CHECK-NEXT: v31 = ToBoolean v30
// CHECK-NEXT: Branch v31 -> taken b4(), notTaken b3(| 0)
// CHECK-NEXT: b3(v32):
// CHECK-NEXT: v33 = Integer integer=1
// CHECK-NEXT: v34 = Add v10, v33
// CHECK-NEXT: v35 = Integer
// CHECK-NEXT: v36 = BitOr v34, v35
// CHECK-NEXT: v37 = Convert v36 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v37)
// CHECK-NEXT: b4():
// CHECK-NEXT: v38 = Convert v10 declared={type=number}
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reverseValues"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: number):
// CHECK-NEXT: Jump -> next b1(v1, v2)
// CHECK-NEXT: b1(v3: number, v4: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = Less v3, v4
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v8 = Convert v3 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v9 = GetOwnContiguousIndex v7, v8
// CHECK-NEXT: v10 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v11 = Convert v4 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v12 = GetOwnContiguousIndex v10, v11
// CHECK-NEXT: v13 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v14 = Convert v3 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v13, v14, v12
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v18 = Convert v4 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v17, v18, v9
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: v21 = Integer integer=1
// CHECK-NEXT: v22 = Add v3, v21
// CHECK-NEXT: v23 = Integer
// CHECK-NEXT: v24 = BitOr v22, v23
// CHECK-NEXT: v25 = Convert v24 declared={type=number}
// CHECK-NEXT: v26 = Integer integer=1
// CHECK-NEXT: v27 = Sub v4, v26
// CHECK-NEXT: v28 = Integer
// CHECK-NEXT: v29 = BitOr v27, v28
// CHECK-NEXT: v30 = Convert v29 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v25, v30)
// CHECK-NEXT: b3():
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="findValueRun"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull]}, {type=number}, {type=number}, {type=anything}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: number, v3: anything):
// CHECK-NEXT: v4 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: Return v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = NarrowByTest v0, v8
// CHECK-NEXT: v10 = Integer integer=8
// CHECK-NEXT: v11 = Integer integer=64
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = BitOr v1, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=number}
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = BitOr v2, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: v18 = GreaterEq v17, v10
// CHECK-NEXT: Branch v18 -> taken b3(), notTaken b13(v14)
// CHECK-NEXT: b3():
// CHECK-NEXT: v19 = Boolean
// CHECK-NEXT: v20 = Convert v19 declared={type=boolean}
// CHECK-NEXT: Jump -> next b4(v14, v20)
// CHECK-NEXT: b4(v21: number, v22: boolean):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v24 = Integer integer=1
// CHECK-NEXT: v25 = Add v21, v24
// CHECK-NEXT: v26 = Integer
// CHECK-NEXT: v27 = BitOr v25, v26
// CHECK-NEXT: v28 = Less v27, v17
// CHECK-NEXT: Branch v28 -> taken b5(), notTaken b9()
// CHECK-NEXT: b5():
// CHECK-NEXT: v29 = Integer integer=1
// CHECK-NEXT: v30 = Add v21, v29
// CHECK-NEXT: v31 = Integer
// CHECK-NEXT: v32 = BitOr v30, v31
// CHECK-NEXT: v33 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v34 = Convert v32 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v35 = GetOwnContiguousIndex v33, v34
// CHECK-NEXT: v36 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v37 = Convert v21 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v38 = GetOwnContiguousIndex v36, v37
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: v41 = Call v3, v40, v35, v38 [isNeverInlined]
// CHECK-NEXT: v42 = Call v39, -, v41 calleeName="isLess"
// CHECK-NEXT: v43 = StrictEq v21, v14
// CHECK-NEXT: Branch v43 -> taken b6(), notTaken b7()
// CHECK-NEXT: b6():
// CHECK-NEXT: v44 = Convert v42 declared={type=boolean}
// CHECK-NEXT: Jump -> next b8(v44)
// CHECK-NEXT: b7():
// CHECK-NEXT: v45 = StrictEq v42, v22
// CHECK-NEXT: Branch v45 -> taken b8(v22), notTaken b9()
// CHECK-NEXT: b8(v46: boolean):
// CHECK-NEXT: v47 = Integer integer=1
// CHECK-NEXT: v48 = Add v21, v47
// CHECK-NEXT: v49 = Integer
// CHECK-NEXT: v50 = BitOr v48, v49
// CHECK-NEXT: v51 = Convert v50 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v51, v46)
// CHECK-NEXT: b9():
// CHECK-NEXT: v52 = ToBoolean v22
// CHECK-NEXT: Branch v52 -> taken b10(| 0), notTaken b11()
// CHECK-NEXT: b10(v53):
// CHECK-NEXT: v54 = GetModuleVariable variable=[[g_34]]
// CHECK-NEXT: v55 = Call v54, -, v9, v14, v21 calleeName="reverseValues"
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v56 = Sub v21, v14
// CHECK-NEXT: v57 = Integer
// CHECK-NEXT: v58 = BitOr v56, v57
// CHECK-NEXT: v59 = GreaterEq v58, v10
// CHECK-NEXT: Branch v59 -> taken b12(), notTaken b13(v21)
// CHECK-NEXT: b12():
// CHECK-NEXT: v60 = GetModuleVariable variable=[[g_35]]
// CHECK-NEXT: v61 = Call v60, -, v9, v21, v17, v3 calleeName="extendValueRun"
// CHECK-NEXT: ReturnCall v61 casts=[{declared={type=number}}]
// CHECK-NEXT: b13(v62: number):
// CHECK-NEXT: v63 = Sub v17, v14
// CHECK-NEXT: v64 = Integer
// CHECK-NEXT: v65 = BitOr v63, v64
// CHECK-NEXT: v66 = Less v65, v11
// CHECK-NEXT: Branch v66 -> taken b15(v17), notTaken b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v67 = Add v14, v11
// CHECK-NEXT: v68 = Integer
// CHECK-NEXT: v69 = BitOr v67, v68
// CHECK-NEXT: Jump -> next b15(v69)
// CHECK-NEXT: b15(v70):
// CHECK-NEXT: v71 = Integer integer=1
// CHECK-NEXT: v72 = Add v62, v71
// CHECK-NEXT: v73 = Integer
// CHECK-NEXT: v74 = BitOr v72, v73
// CHECK-NEXT: v75 = Convert v74 declared={type=number}
// CHECK-NEXT: Jump -> next b16(v75)
// CHECK-NEXT: b16(v76: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v78 = Less v76, v70
// CHECK-NEXT: Branch v78 -> taken b17(), notTaken b29()
// CHECK-NEXT: b17():
// CHECK-NEXT: v79 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v80 = Convert v76 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v81 = GetOwnContiguousIndex v79, v80
// CHECK-NEXT: v82 = Convert v76 declared={type=number}
// CHECK-NEXT: Jump -> next b18(v14, v82)
// CHECK-NEXT: b18(v83: number, v84: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v86 = Less v83, v84
// CHECK-NEXT: Branch v86 -> taken b19(), notTaken b23()
// CHECK-NEXT: b19():
// CHECK-NEXT: v87 = Sub v84, v83
// CHECK-NEXT: v88 = Integer integer=1
// CHECK-NEXT: v89 = RShift v87, v88
// CHECK-NEXT: v90 = Add v83, v89
// CHECK-NEXT: v91 = Integer
// CHECK-NEXT: v92 = BitOr v90, v91
// CHECK-NEXT: v93 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v94 = Convert v92 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v95 = GetOwnContiguousIndex v93, v94
// CHECK-NEXT: v96 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v97 = Undefined
// CHECK-NEXT: v98 = Call v3, v97, v81, v95
// CHECK-NEXT: v99 = Call v96, -, v98 calleeName="isLess"
// CHECK-NEXT: v100 = ToBoolean v99
// CHECK-NEXT: Branch v100 -> taken b20(| 0), notTaken b21(| 0)
// CHECK-NEXT: b20(v101):
// CHECK-NEXT: v102 = Convert v92 declared={type=number}
// CHECK-NEXT: Jump -> next b22(v83, v102)
// CHECK-NEXT: b21(v103):
// CHECK-NEXT: v104 = Integer integer=1
// CHECK-NEXT: v105 = Add v92, v104
// CHECK-NEXT: v106 = Integer
// CHECK-NEXT: v107 = BitOr v105, v106
// CHECK-NEXT: v108 = Convert v107 declared={type=number}
// CHECK-NEXT: Jump -> next b22(v108, v84)
// CHECK-NEXT: b22(v109: number, v110: number):
// CHECK-NEXT: Jump -> next b18(v109, v110)
// CHECK-NEXT: b23():
// CHECK-NEXT: v111 = Convert v76 declared={type=number}
// CHECK-NEXT: Jump -> next b24(v111)
// CHECK-NEXT: b24(v112: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v114 = Integer integer=1
// CHECK-NEXT: v115 = Sub v112, v114
// CHECK-NEXT: v116 = Greater v115, v83
// CHECK-NEXT: Branch v116 -> taken b25(), notTaken b26()
// CHECK-NEXT: b25():
// CHECK-NEXT: v117 = Integer integer=1
// CHECK-NEXT: v118 = Sub v112, v117
// CHECK-NEXT: v119 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v120 = Convert v118 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v121 = GetOwnContiguousIndex v119, v120
// CHECK-NEXT: v122 = Integer integer=2
// CHECK-NEXT: v123 = Sub v112, v122
// CHECK-NEXT: v124 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v125 = Convert v123 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v126 = GetOwnContiguousIndex v124, v125
// CHECK-NEXT: v127 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v128 = Convert v112 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v127, v128, v121
// CHECK-NEXT: v130 = Undefined
// CHECK-NEXT: v131 = Integer integer=1
// CHECK-NEXT: v132 = Sub v112, v131
// CHECK-NEXT: v133 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v134 = Convert v132 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v133, v134, v126
// CHECK-NEXT: v136 = Undefined
// CHECK-NEXT: v137 = Integer integer=2
// CHECK-NEXT: v138 = Sub v112, v137
// CHECK-NEXT: v139 = Integer
// CHECK-NEXT: v140 = BitOr v138, v139
// CHECK-NEXT: v141 = Convert v140 declared={type=number}
// CHECK-NEXT: Jump -> next b24(v141)
// CHECK-NEXT: b26():
// CHECK-NEXT: v142 = Greater v112, v83
// CHECK-NEXT: Branch v142 -> taken b27(), notTaken b28()
// CHECK-NEXT: b27():
// CHECK-NEXT: v143 = Integer integer=1
// CHECK-NEXT: v144 = Sub v112, v143
// CHECK-NEXT: v145 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v146 = Convert v144 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v147 = GetOwnContiguousIndex v145, v146
// CHECK-NEXT: v148 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v149 = Convert v112 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v148, v149, v147
// CHECK-NEXT: v151 = Undefined
// CHECK-NEXT: Jump -> next b28()
// CHECK-NEXT: b28():
// CHECK-NEXT: v152 = Convert v9 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v153 = Convert v83 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v152, v153, v81
// CHECK-NEXT: v155 = Undefined
// CHECK-NEXT: v156 = Integer integer=1
// CHECK-NEXT: v157 = Add v76, v156
// CHECK-NEXT: v158 = Integer
// CHECK-NEXT: v159 = BitOr v157, v158
// CHECK-NEXT: v160 = Convert v159 declared={type=number}
// CHECK-NEXT: Jump -> next b16(v160)
// CHECK-NEXT: b29():
// CHECK-NEXT: v161 = GreaterEq v70, v17
// CHECK-NEXT: Branch v161 -> taken b30(), notTaken b31()
// CHECK-NEXT: b30():
// CHECK-NEXT: v162 = Integer integer=1
// CHECK-NEXT: v163 = Sub v70, v162
// CHECK-NEXT: v164 = Integer
// CHECK-NEXT: v165 = BitOr v163, v164
// CHECK-NEXT: v166 = Convert v165 declared={type=number}
// CHECK-NEXT: Return v166
// CHECK-NEXT: b31():
// CHECK-NEXT: v167 = GetModuleVariable variable=[[g_35]]
// CHECK-NEXT: v168 = Integer integer=1
// CHECK-NEXT: v169 = Sub v70, v168
// CHECK-NEXT: v170 = Call v167, -, v9, v169, v17, v3 calleeName="extendValueRun"
// CHECK-NEXT: ReturnCall v170 casts=[{declared={type=number}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mergeValueRuns"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=6 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}, {type=number}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: undefined|null|Array, v2: number, v3: number, v4: number, v5: anything):
// CHECK-NEXT: v6 = Integer integer=7
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_36]]
// CHECK-NEXT: v8 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v9 = Convert v3 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v10 = GetOwnContiguousIndex v8, v9
// CHECK-NEXT: v11 = Sub v3, v2
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = Call v7, -, v10, v0, v2, v11, v12, v5 calleeName="gallopRight"
// CHECK-NEXT: v14 = Add v2, v13
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = BitOr v14, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: v18 = GreaterEq v17, v3
// CHECK-NEXT: Branch v18 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: b2():
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_37]]
// CHECK-NEXT: v21 = Integer integer=1
// CHECK-NEXT: v22 = Sub v3, v21
// CHECK-NEXT: v23 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v24 = Convert v22 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v25 = GetOwnContiguousIndex v23, v24
// CHECK-NEXT: v26 = Integer integer=1
// CHECK-NEXT: v27 = Add v4, v26
// CHECK-NEXT: v28 = Sub v27, v3
// CHECK-NEXT: v29 = Sub v4, v3
// CHECK-NEXT: v30 = Call v20, -, v25, v0, v3, v28, v29, v5 calleeName="gallopLeft"
// CHECK-NEXT: v31 = Add v3, v30
// CHECK-NEXT: v32 = Integer
// CHECK-NEXT: v33 = BitOr v31, v32
// CHECK-NEXT: v34 = LessEq v33, v3
// CHECK-NEXT: Branch v34 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: b4():
// CHECK-NEXT: v36 = PropGet v1 key="length"
// CHECK-NEXT: v37 = Integer integer=1
// CHECK-NEXT: v38 = Sub v36, v37
// CHECK-NEXT: v39 = Integer
// CHECK-NEXT: v40 = BitOr v38, v39
// CHECK-NEXT: v41 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v42 = Convert v40 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v43 = GetOwnContiguousIndex v41, v42
// CHECK-NEXT: v44 = Integer
// CHECK-NEXT: v45 = BitOr v43, v44
// CHECK-NEXT: v46 = Convert v45 declared={type=number}
// CHECK-NEXT: v47 = Convert v3 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v17, v46, v47, v17)
// CHECK-NEXT: b5(v48: number, v49: number, v50: number, v51: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v53 = Integer
// CHECK-NEXT: v54 = Convert v53 declared={type=number}
// CHECK-NEXT: v55 = Integer
// CHECK-NEXT: v56 = Convert v55 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v48, v50, v51, v54, v56)
// CHECK-NEXT: b6(v57: number, v58: number, v59: number, v60: number, v61: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v63 = Less v60, v49
// CHECK-NEXT: Branch v63 -> taken b7(), notTaken b14()
// CHECK-NEXT: b7():
// CHECK-NEXT: v64 = Less v61, v49
// CHECK-NEXT: Branch v64 -> taken b8(), notTaken b14()
// CHECK-NEXT: b8():
// CHECK-NEXT: v65 = GreaterEq v58, v33
// CHECK-NEXT: Branch v65 -> taken b29(v49, v57, v59, v58), notTaken b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v66 = GreaterEq v57, v3
// CHECK-NEXT: Branch v66 -> taken b29(v49, v57, v59, v58), notTaken b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v67 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v68 = Convert v57 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v69 = GetOwnContiguousIndex v67, v68
// CHECK-NEXT: v70 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v71 = Convert v58 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v72 = GetOwnContiguousIndex v70, v71
// CHECK-NEXT: v73 = GetModuleVariable variable=[[g_33]]
// CHECK-NEXT: v74 = Undefined
// CHECK-NEXT: v75 = Call v5, v74, v72, v69
// CHECK-NEXT: v76 = Call v73, -, v75 calleeName="isLess"
// CHECK-NEXT: v77 = ToBoolean v76
// CHECK-NEXT: Branch v77 -> taken b11(| 0), notTaken b12(| 0)
// CHECK-NEXT: b11(v78):
// CHECK-NEXT: v79 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v80 = Convert v59 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v79, v80, v72
// CHECK-NEXT: v82 = Undefined
// CHECK-NEXT: v83 = Integer integer=1
// CHECK-NEXT: v84 = Add v58, v83
// CHECK-NEXT: v85 = Integer
// CHECK-NEXT: v86 = BitOr v84, v85
// CHECK-NEXT: v87 = Convert v86 declared={type=number}
// CHECK-NEXT: v88 = Integer integer=1
// CHECK-NEXT: v89 = Add v61, v88
// CHECK-NEXT: v90 = Integer
// CHECK-NEXT: v91 = BitOr v89, v90
// CHECK-NEXT: v92 = Convert v91 declared={type=number}
// CHECK-NEXT: v93 = Integer
// CHECK-NEXT: v94 = Convert v93 declared={type=number}
// CHECK-NEXT: Jump -> next b13(v57, v87, v94, v92)
// CHECK-NEXT: b12(v95):
// CHECK-NEXT: v96 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v97 = Convert v59 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v96, v97, v69
// CHECK-NEXT: v99 = Undefined
// CHECK-NEXT: v100 = Integer integer=1
// CHECK-NEXT: v101 = Add v57, v100
// CHECK-NEXT: v102 = Integer
// CHECK-NEXT: v103 = BitOr v101, v102
// CHECK-NEXT: v104 = Convert v103 declared={type=number}
// CHECK-NEXT: v105 = Integer integer=1
// CHECK-NEXT: v106 = Add v60, v105
// CHECK-NEXT: v107 = Integer
// CHECK-NEXT: v108 = BitOr v106, v107
// CHECK-NEXT: v109 = Convert v108 declared={type=number}
// CHECK-NEXT: v110 = Integer
// CHECK-NEXT: v111 = Convert v110 declared={type=number}
// CHECK-NEXT: Jump -> next b13(v104, v58, v109, v111)
// CHECK-NEXT: b13(v112: number, v113: number, v114: number, v115: number):
// CHECK-NEXT: v116 = Integer integer=1
// CHECK-NEXT: v117 = Add v59, v116
// CHECK-NEXT: v118 = Integer
// CHECK-NEXT: v119 = BitOr v117, v118
// CHECK-NEXT: v120 = Convert v119 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v112, v113, v120, v114, v115)
// CHECK-NEXT: b14():
// CHECK-NEXT: v121 = Integer integer=1
// CHECK-NEXT: v122 = Add v49, v121
// CHECK-NEXT: v123 = Integer
// CHECK-NEXT: v124 = BitOr v122, v123
// CHECK-NEXT: v125 = Convert v124 declared={type=number}
// CHECK-NEXT: Jump -> next b15(v57, v125, v58, v59, v60, v61)
// CHECK-NEXT: b15(v126: number, v127: number, v128: number, v129: number, v130: number, v131: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v133 = Integer integer=1
// CHECK-NEXT: v134 = Greater v127, v133
// CHECK-NEXT: Branch v134 -> taken b16(), notTaken b17(v127)
// CHECK-NEXT: b16():
// CHECK-NEXT: v135 = Integer integer=1
// CHECK-NEXT: v136 = Sub v127, v135
// CHECK-NEXT: v137 = Integer
// CHECK-NEXT: v138 = BitOr v136, v137
// CHECK-NEXT: v139 = Convert v138 declared={type=number}
// CHECK-NEXT: Jump -> next b17(v139)
// CHECK-NEXT: b17(v140: number):
// CHECK-NEXT: v141 = GreaterEq v126, v3
// CHECK-NEXT: Branch v141 -> taken b29(v140, v126, v129, v128), notTaken b18()
// CHECK-NEXT: b18():
// CHECK-NEXT: v142 = GreaterEq v128, v33
// CHECK-NEXT: Branch v142 -> taken b29(v140, v126, v129, v128), notTaken b19()
// CHECK-NEXT: b19():
// CHECK-NEXT: v143 = GetModuleVariable variable=[[g_36]]
// CHECK-NEXT: v144 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v145 = Convert v128 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v146 = GetOwnContiguousIndex v144, v145
// CHECK-NEXT: v147 = Sub v3, v126
// CHECK-NEXT: v148 = Integer
// CHECK-NEXT: v149 = Call v143, -, v146, v0, v126, v147, v148, v5 calleeName="gallopRight"
// CHECK-NEXT: v150 = Convert v149 declared={type=number}
// CHECK-NEXT: v151 = Integer
// CHECK-NEXT: v152 = Convert v151 declared={type=number}
// CHECK-NEXT: Jump -> next b20(v126, v129, v152)
// CHECK-NEXT: b20(v153: number, v154: number, v155: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v157 = Less v155, v150
// CHECK-NEXT: Branch v157 -> taken b21(), notTaken b22()
// CHECK-NEXT: b21():
// CHECK-NEXT: v158 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v159 = Convert v153 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v160 = GetOwnContiguousIndex v158, v159
// CHECK-NEXT: v161 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v162 = Convert v154 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v161, v162, v160
// CHECK-NEXT: v164 = Undefined
// CHECK-NEXT: v165 = Integer integer=1
// CHECK-NEXT: v166 = Add v155, v165
// CHECK-NEXT: v167 = Integer
// CHECK-NEXT: v168 = BitOr v166, v167
// CHECK-NEXT: v169 = Convert v168 declared={type=number}
// CHECK-NEXT: v170 = Integer integer=1
// CHECK-NEXT: v171 = Add v154, v170
// CHECK-NEXT: v172 = Integer
// CHECK-NEXT: v173 = BitOr v171, v172
// CHECK-NEXT: v174 = Convert v173 declared={type=number}
// CHECK-NEXT: v175 = Integer integer=1
// CHECK-NEXT: v176 = Add v153, v175
// CHECK-NEXT: v177 = Integer
// CHECK-NEXT: v178 = BitOr v176, v177
// CHECK-NEXT: v179 = Convert v178 declared={type=number}
// CHECK-NEXT: Jump -> next b20(v179, v174, v169)
// CHECK-NEXT: b22():
// CHECK-NEXT: v180 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v181 = Convert v128 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v182 = GetOwnContiguousIndex v180, v181
// CHECK-NEXT: v183 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v184 = Convert v154 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v183, v184, v182
// CHECK-NEXT: v186 = Undefined
// CHECK-NEXT: v187 = Integer integer=1
// CHECK-NEXT: v188 = Add v154, v187
// CHECK-NEXT: v189 = Integer
// CHECK-NEXT: v190 = BitOr v188, v189
// CHECK-NEXT: v191 = Convert v190 declared={type=number}
// CHECK-NEXT: v192 = Integer integer=1
// CHECK-NEXT: v193 = Add v128, v192
// CHECK-NEXT: v194 = Integer
// CHECK-NEXT: v195 = BitOr v193, v194
// CHECK-NEXT: v196 = Convert v195 declared={type=number}
// CHECK-NEXT: v197 = GreaterEq v153, v3
// CHECK-NEXT: Branch v197 -> taken b29(v140, v153, v191, v196), notTaken b23()
// CHECK-NEXT: b23():
// CHECK-NEXT: v198 = GreaterEq v196, v33
// CHECK-NEXT: Branch v198 -> taken b29(v140, v153, v191, v196), notTaken b24()
// CHECK-NEXT: b24():
// CHECK-NEXT: v199 = GetModuleVariable variable=[[g_37]]
// CHECK-NEXT: v200 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v201 = Convert v153 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v202 = GetOwnContiguousIndex v200, v201
// CHECK-NEXT: v203 = Sub v33, v196
// CHECK-NEXT: v204 = Integer
// CHECK-NEXT: v205 = Call v199, -, v202, v0, v196, v203, v204, v5 calleeName="gallopLeft"
// CHECK-NEXT: v206 = Convert v205 declared={type=number}
// CHECK-NEXT: v207 = Integer
// CHECK-NEXT: v208 = Convert v207 declared={type=number}
// CHECK-NEXT: Jump -> next b25(v196, v191, v208)
// CHECK-NEXT: b25(v209: number, v210: number, v211: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v213 = Less v211, v206
// CHECK-NEXT: Branch v213 -> taken b26(), notTaken b27()
// CHECK-NEXT: b26():
// CHECK-NEXT: v214 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v215 = Convert v209 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v216 = GetOwnContiguousIndex v214, v215
// CHECK-NEXT: v217 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v218 = Convert v210 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v217, v218, v216
// CHECK-NEXT: v220 = Undefined
// CHECK-NEXT: v221 = Integer integer=1
// CHECK-NEXT: v222 = Add v211, v221
// CHECK-NEXT: v223 = Integer
// CHECK-NEXT: v224 = BitOr v222, v223
// CHECK-NEXT: v225 = Convert v224 declared={type=number}
// CHECK-NEXT: v226 = Integer integer=1
// CHECK-NEXT: v227 = Add v210, v226
// CHECK-NEXT: v228 = Integer
// CHECK-NEXT: v229 = BitOr v227, v228
// CHECK-NEXT: v230 = Convert v229 declared={type=number}
// CHECK-NEXT: v231 = Integer integer=1
// CHECK-NEXT: v232 = Add v209, v231
// CHECK-NEXT: v233 = Integer
// CHECK-NEXT: v234 = BitOr v232, v233
// CHECK-NEXT: v235 = Convert v234 declared={type=number}
// CHECK-NEXT: Jump -> next b25(v235, v230, v225)
// CHECK-NEXT: b27():
// CHECK-NEXT: v236 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v237 = Convert v153 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v238 = GetOwnContiguousIndex v236, v237
// CHECK-NEXT: v239 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v240 = Convert v210 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v239, v240, v238
// CHECK-NEXT: v242 = Undefined
// CHECK-NEXT: v243 = Integer integer=1
// CHECK-NEXT: v244 = Add v210, v243
// CHECK-NEXT: v245 = Integer
// CHECK-NEXT: v246 = BitOr v244, v245
// CHECK-NEXT: v247 = Convert v246 declared={type=number}
// CHECK-NEXT: v248 = Integer integer=1
// CHECK-NEXT: v249 = Add v153, v248
// CHECK-NEXT: v250 = Integer
// CHECK-NEXT: v251 = BitOr v249, v250
// CHECK-NEXT: v252 = Convert v251 declared={type=number}
// CHECK-NEXT: v253 = GreaterEq v252, v3
// CHECK-NEXT: Branch v253 -> taken b29(v140, v252, v247, v209), notTaken b28()
// CHECK-NEXT: b28():
// CHECK-NEXT: v254 = GreaterEq v209, v33
// CHECK-NEXT: Branch v254 -> taken b29(v140, v252, v247, v209), notTaken b39()
// CHECK-NEXT: b29(v255: number, v256: number, v257: number, v258: number):
// CHECK-NEXT: v259 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v260 = Convert v40 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v259, v260, v255
// CHECK-NEXT: v262 = Undefined
// CHECK-NEXT: Jump -> next b30(v256, v257)
// CHECK-NEXT: b30(v263: number, v264: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v266 = Less v263, v3
// CHECK-NEXT: Branch v266 -> taken b31(), notTaken b32()
// CHECK-NEXT: b31():
// CHECK-NEXT: v267 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v268 = Convert v263 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v269 = GetOwnContiguousIndex v267, v268
// CHECK-NEXT: v270 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v271 = Convert v264 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v270, v271, v269
// CHECK-NEXT: v273 = Undefined
// CHECK-NEXT: v274 = Integer integer=1
// CHECK-NEXT: v275 = Add v263, v274
// CHECK-NEXT: v276 = Integer
// CHECK-NEXT: v277 = BitOr v275, v276
// CHECK-NEXT: v278 = Convert v277 declared={type=number}
// CHECK-NEXT: v279 = Integer integer=1
// CHECK-NEXT: v280 = Add v264, v279
// CHECK-NEXT: v281 = Integer
// CHECK-NEXT: v282 = BitOr v280, v281
// CHECK-NEXT: v283 = Convert v282 declared={type=number}
// CHECK-NEXT: Jump -> next b30(v278, v283)
// CHECK-NEXT: b32():
// CHECK-NEXT: Jump -> next b33(v258, v264)
// CHECK-NEXT: b33(v284: number, v285: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v287 = Less v284, v33
// CHECK-NEXT: Branch v287 -> taken b34(), notTaken b35()
// CHECK-NEXT: b34():
// CHECK-NEXT: v288 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v289 = Convert v284 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v290 = GetOwnContiguousIndex v288, v289
// CHECK-NEXT: v291 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v292 = Convert v285 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v291, v292, v290
// CHECK-NEXT: v294 = Undefined
// CHECK-NEXT: v295 = Integer integer=1
// CHECK-NEXT: v296 = Add v284, v295
// CHECK-NEXT: v297 = Integer
// CHECK-NEXT: v298 = BitOr v296, v297
// CHECK-NEXT: v299 = Convert v298 declared={type=number}
// CHECK-NEXT: v300 = Integer integer=1
// CHECK-NEXT: v301 = Add v285, v300
// CHECK-NEXT: v302 = Integer
// CHECK-NEXT: v303 = BitOr v301, v302
// CHECK-NEXT: v304 = Convert v303 declared={type=number}
// CHECK-NEXT: Jump -> next b33(v299, v304)
// CHECK-NEXT: b35():
// CHECK-NEXT: Jump -> next b36(v17)
// CHECK-NEXT: b36(v305: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v307 = Less v305, v33
// CHECK-NEXT: Branch v307 -> taken b37(), notTaken b38()
// CHECK-NEXT: b37():
// CHECK-NEXT: v308 = Convert v1 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v309 = Convert v305 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v310 = GetOwnContiguousIndex v308, v309
// CHECK-NEXT: v311 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v312 = Convert v305 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v311, v312, v310
// CHECK-NEXT: v314 = Undefined
// CHECK-NEXT: v315 = Integer integer=1
// CHECK-NEXT: v316 = Add v305, v315
// CHECK-NEXT: v317 = Integer
// CHECK-NEXT: v318 = BitOr v316, v317
// CHECK-NEXT: v319 = Convert v318 declared={type=number}
// CHECK-NEXT: Jump -> next b36(v319)
// CHECK-NEXT: b38():
// CHECK-NEXT: v320 = Undefined
// CHECK-NEXT: Return v320
// CHECK-NEXT: b39():
// CHECK-NEXT: v321 = Integer integer=7
// CHECK-NEXT: v322 = GreaterEq v150, v321
// CHECK-NEXT: Branch v322 -> taken b15(v252, v140, v209, v247, v150, v206), notTaken b40()
// CHECK-NEXT: b40():
// CHECK-NEXT: v323 = Integer integer=7
// CHECK-NEXT: v324 = GreaterEq v206, v323
// CHECK-NEXT: Branch v324 -> taken b15(v252, v140, v209, v247, v150, v206), notTaken b41()
// CHECK-NEXT: b41():
// CHECK-NEXT: v325 = Integer integer=1
// CHECK-NEXT: v326 = Add v140, v325
// CHECK-NEXT: v327 = Integer
// CHECK-NEXT: v328 = BitOr v326, v327
// CHECK-NEXT: v329 = Convert v328 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v252, v329, v209, v247)
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sortValues"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: anything):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_38]]
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Call v3, -, v0, v4, v1, v2 calleeName="findValueRun"
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = BitOr v5, v6
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = BitOr v9, v10
// CHECK-NEXT: v12 = Less v11, v1
// CHECK-NEXT: Branch v12 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_39]]
// CHECK-NEXT: v14 = Call v13, -, v0, v1, v7, v2 calleeName="mergeFurtherValueRuns"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mergeFurtherValueRuns"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: number, v3: anything):
// CHECK-NEXT: v4 = Integer integer=7
// CHECK-NEXT: v5 = Integer integer=72
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = Convert v9 declared={type=number}
// CHECK-NEXT: v11 = Convert v2 declared={type=number}
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Add v2, v12
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = BitOr v13, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v6, v8, v10, v11, v16)
// CHECK-NEXT: b1(v17: undefined|null|Array, v18: number, v19: number, v20: number, v21: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v23 = Convert v21 declared={type=number}
// CHECK-NEXT: v24 = Integer integer=-1
// CHECK-NEXT: v25 = Convert v24 declared={type=number}
// CHECK-NEXT: v26 = Less v21, v1
// CHECK-NEXT: Branch v26 -> taken b2(), notTaken b3(v25, v23)
// CHECK-NEXT: b2():
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_38]]
// CHECK-NEXT: v28 = Call v27, -, v0, v21, v1, v3 calleeName="findValueRun"
// CHECK-NEXT: v29 = Convert v28 declared={type=number}
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_40]]
// CHECK-NEXT: v31 = Call v30, -, v19, v21, v29, v1 calleeName="computeRunPower"
// CHECK-NEXT: v32 = Convert v31 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v32, v29)
// CHECK-NEXT: b3(v33: number, v34: number):
// CHECK-NEXT: Jump -> next b4(v18, v19)
// CHECK-NEXT: b4(v35: number, v36: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v38 = Integer
// CHECK-NEXT: v39 = Greater v35, v38
// CHECK-NEXT: Branch v39 -> taken b5(), notTaken b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: v40 = Integer integer=2
// CHECK-NEXT: v41 = Mul v35, v40
// CHECK-NEXT: v42 = Add v1, v41
// CHECK-NEXT: v43 = Integer integer=1
// CHECK-NEXT: v44 = Sub v42, v43
// CHECK-NEXT: v45 = Convert v17 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v46 = Convert v44 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v47 = GetOwnContiguousIndex v45, v46
// CHECK-NEXT: v48 = Convert v47 declared={type=number}
// CHECK-NEXT: v49 = LessEq v48, v33
// CHECK-NEXT: Branch v49 -> taken b7(), notTaken b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v50 = Integer integer=1
// CHECK-NEXT: v51 = Sub v35, v50
// CHECK-NEXT: v52 = Integer
// CHECK-NEXT: v53 = BitOr v51, v52
// CHECK-NEXT: v54 = Convert v53 declared={type=number}
// CHECK-NEXT: v55 = Integer integer=2
// CHECK-NEXT: v56 = Mul v54, v55
// CHECK-NEXT: v57 = Add v1, v56
// CHECK-NEXT: v58 = Convert v17 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v59 = Convert v57 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v60 = GetOwnContiguousIndex v58, v59
// CHECK-NEXT: v61 = Integer
// CHECK-NEXT: v62 = BitOr v60, v61
// CHECK-NEXT: v63 = Convert v62 declared={type=number}
// CHECK-NEXT: v64 = GetModuleVariable variable=[[g_41]]
// CHECK-NEXT: v65 = Call v64, -, v0, v17, v63, v36, v20, v3 calleeName="mergeValueRuns"
// CHECK-NEXT: Jump -> next b4(v54, v63)
// CHECK-NEXT: b7():
// CHECK-NEXT: v66 = GreaterEq v21, v1
// CHECK-NEXT: Branch v66 -> taken b8(), notTaken b9()
// CHECK-NEXT: b8():
// CHECK-NEXT: v67 = Undefined
// CHECK-NEXT: Return v67
// CHECK-NEXT: b9():
// CHECK-NEXT: v68 = StrictEq v17, v0
// CHECK-NEXT: Branch v68 -> taken b10(), notTaken b11(v17)
// CHECK-NEXT: b10():
// CHECK-NEXT: v69 = Integer integer=72
// CHECK-NEXT: v70 = Add v1, v69
// CHECK-NEXT: v71 = Integer integer=1
// CHECK-NEXT: v72 = Add v70, v71
// CHECK-NEXT: v73 = Convert v72 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v74 = NewContiguousArray v73
// CHECK-NEXT: v75 = Convert v74 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v76 = Integer integer=72
// CHECK-NEXT: v77 = Add v1, v76
// CHECK-NEXT: v78 = Integer integer=7
// CHECK-NEXT: v79 = Convert v75 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v80 = Convert v77 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v79, v80, v78
// CHECK-NEXT: v82 = Undefined
// CHECK-NEXT: Jump -> next b11(v75)
// CHECK-NEXT: b11(v83: undefined|null|Array):
// CHECK-NEXT: v84 = Integer integer=2
// CHECK-NEXT: v85 = Mul v35, v84
// CHECK-NEXT: v86 = Add v1, v85
// CHECK-NEXT: v87 = Convert v83 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v88 = Convert v86 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v87, v88, v36
// CHECK-NEXT: v90 = Undefined
// CHECK-NEXT: v91 = Integer integer=2
// CHECK-NEXT: v92 = Mul v35, v91
// CHECK-NEXT: v93 = Add v1, v92
// CHECK-NEXT: v94 = Integer integer=1
// CHECK-NEXT: v95 = Add v93, v94
// CHECK-NEXT: v96 = Convert v83 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v97 = Convert v95 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v96, v97, v33
// CHECK-NEXT: v99 = Undefined
// CHECK-NEXT: v100 = Integer integer=1
// CHECK-NEXT: v101 = Add v35, v100
// CHECK-NEXT: v102 = Integer
// CHECK-NEXT: v103 = BitOr v101, v102
// CHECK-NEXT: v104 = Convert v103 declared={type=number}
// CHECK-NEXT: v105 = Convert v21 declared={type=number}
// CHECK-NEXT: v106 = Convert v34 declared={type=number}
// CHECK-NEXT: v107 = Integer integer=1
// CHECK-NEXT: v108 = Add v34, v107
// CHECK-NEXT: v109 = Integer
// CHECK-NEXT: v110 = BitOr v108, v109
// CHECK-NEXT: v111 = Convert v110 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v83, v104, v105, v106, v111)
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="moveToLongerArray"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number):
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v5 = NewContiguousArray v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v8)
// CHECK-NEXT: b1(v9: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v11 = Less v9, v1
// CHECK-NEXT: Branch v11 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v12 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v13 = Convert v9 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v14 = GetOwnContiguousIndex v12, v13
// CHECK-NEXT: v15 = Convert v6 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v16 = Convert v9 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v15, v16, v14
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = Add v9, v19
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: v22 = BitOr v20, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v23)
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="putRestOfSortedValues"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=6 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}, {type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: undefined|null|Array, v3: number, v4: number, v5: number):
// CHECK-NEXT: Jump -> next b1(v4)
// CHECK-NEXT: b1(v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Less v6, v3
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Convert v2 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v10 = Convert v6 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v11 = GetContiguousIndex v9, v10
// CHECK-NEXT: v12 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v13 = Convert v6 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v14 = TryPutIndex v12, v13, v11
// CHECK-NEXT: v15 = Convert v14 declared={type=boolean}
// CHECK-NEXT: v16 = ToBoolean v15
// CHECK-NEXT: Branch v16 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: ElemSet v0, v6, v11
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = Increment v6
// CHECK-NEXT: v21 = Convert v20 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v21)
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7(v6, v5)
// CHECK-NEXT: b7(v22: number, v23: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v25 = Integer
// CHECK-NEXT: v26 = Greater v23, v25
// CHECK-NEXT: Branch v26 -> taken b8(), notTaken b10()
// CHECK-NEXT: b8():
// CHECK-NEXT: v27 = Less v22, v1
// CHECK-NEXT: Branch v27 -> taken b9(), notTaken b10()
// CHECK-NEXT: b9():
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: ElemSet v0, v22, v28
// CHECK-NEXT: v30 = Decrement v23
// CHECK-NEXT: v31 = Convert v30 declared={type=number}
// CHECK-NEXT: v32 = Increment v22
// CHECK-NEXT: v33 = Convert v32 declared={type=number}
// CHECK-NEXT: Jump -> next b7(v33, v31)
// CHECK-NEXT: b10():
// CHECK-NEXT: Jump -> next b11(v22)
// CHECK-NEXT: b11(v34: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v36 = Less v34, v1
// CHECK-NEXT: Branch v36 -> taken b12(), notTaken b13()
// CHECK-NEXT: b12():
// CHECK-NEXT: v37 = ElemDelete v0, v34
// CHECK-NEXT: v38 = Increment v34
// CHECK-NEXT: v39 = Convert v38 declared={type=number}
// CHECK-NEXT: Jump -> next b11(v39)
// CHECK-NEXT: b13():
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="putSortedValues"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=5 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: undefined|null|Array, v3: number, v4: number):
// CHECK-NEXT: v5 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v6 = Convert v2 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v7 = Convert v3 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v8 = TryPutElements v5, v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=boolean}
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b2(v3), notTaken b1(| 0)
// CHECK-NEXT: b1(v11):
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: Jump -> next b2(v12)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: v14 = Less v13, v1
// CHECK-NEXT: Branch v14 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_42]]
// CHECK-NEXT: v16 = Call v15, -, v0, v1, v2, v3, v13, v4 calleeName="putRestOfSortedValues"
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sortListOfAnyKind"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: anything):
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_43]]
// CHECK-NEXT: v10 = Call v9, -, v0 calleeName="isContiguousArray"
// CHECK-NEXT: v11 = ToBoolean v10
// CHECK-NEXT: Branch v11 -> taken b1(| 0), notTaken b9(| 0)
// CHECK-NEXT: b1(v12):
// CHECK-NEXT: v13 = Convert v1 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v14 = NewContiguousArray v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: Jump -> next b2(v6, v8, v17)
// CHECK-NEXT: b2(v18: number, v19: number, v20: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v22 = Less v20, v1
// CHECK-NEXT: Branch v22 -> taken b3(), notTaken b20(v15, v18, v19)
// CHECK-NEXT: b3():
// CHECK-NEXT: v23 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v24 = Convert v20 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v25 = GetContiguousIndex v23, v24
// CHECK-NEXT: v26 = TypeTest v25 testedType=undefined
// CHECK-NEXT: Branch v26 -> taken b4(| 0), notTaken b7(| 0)
// CHECK-NEXT: b4(v27):
// CHECK-NEXT: v28 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v29 = Convert v20 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v30 = HasContiguousIndex v28, v29
// CHECK-NEXT: v31 = Convert v30 declared={type=boolean}
// CHECK-NEXT: v32 = ToBoolean v31
// CHECK-NEXT: Branch v32 -> taken b5(| 0), notTaken b6(v19)
// CHECK-NEXT: b5(v33):
// CHECK-NEXT: v34 = Increment v19
// CHECK-NEXT: v35 = Convert v34 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v35)
// CHECK-NEXT: b6(v36: number):
// CHECK-NEXT: Jump -> next b8(v18, v36)
// CHECK-NEXT: b7(v37):
// CHECK-NEXT: v38 = NarrowByTest v25, v37
// CHECK-NEXT: v39 = Convert v15 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v40 = Convert v18 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v39, v40, v38
// CHECK-NEXT: v42 = Undefined
// CHECK-NEXT: v43 = Integer integer=1
// CHECK-NEXT: v44 = Add v18, v43
// CHECK-NEXT: v45 = Integer
// CHECK-NEXT: v46 = BitOr v44, v45
// CHECK-NEXT: v47 = Convert v46 declared={type=number}
// CHECK-NEXT: Jump -> next b8(v47, v19)
// CHECK-NEXT: b8(v48: number, v49: number):
// CHECK-NEXT: v50 = Increment v20
// CHECK-NEXT: v51 = Convert v50 declared={type=number}
// CHECK-NEXT: Jump -> next b2(v48, v49, v51)
// CHECK-NEXT: b9(v52):
// CHECK-NEXT: v53 = GetModuleVariable variable=[[g_44]]
// CHECK-NEXT: v54 = Call v53, -, v0 calleeName="isDoubleArray"
// CHECK-NEXT: v55 = ToBoolean v54
// CHECK-NEXT: Branch v55 -> taken b11(v1), notTaken b10(| 0)
// CHECK-NEXT: b10(v56):
// CHECK-NEXT: v57 = Integer integer=16
// CHECK-NEXT: Jump -> next b11(v57)
// CHECK-NEXT: b11(v58):
// CHECK-NEXT: v59 = Convert v58 declared={type=number}
// CHECK-NEXT: v60 = Convert v59 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v61 = NewContiguousArray v60
// CHECK-NEXT: v62 = Convert v61 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: v63 = Integer
// CHECK-NEXT: v64 = Convert v63 declared={type=number}
// CHECK-NEXT: Jump -> next b12(v62, v6, v8, v59, v64)
// CHECK-NEXT: b12(v65: undefined|null|Array, v66: number, v67: number, v68: number, v69: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v71 = Less v69, v1
// CHECK-NEXT: Branch v71 -> taken b13(), notTaken b20(v65, v66, v67)
// CHECK-NEXT: b13():
// CHECK-NEXT: v72 = ElemHas v0, v69
// CHECK-NEXT: v73 = ToBoolean v72
// CHECK-NEXT: Branch v73 -> taken b14(| 0), notTaken b19(v65, v66, v67, v68)
// CHECK-NEXT: b14(v74):
// CHECK-NEXT: v75 = ElemGet v0, v69
// CHECK-NEXT: v76 = TypeTest v75 testedType=undefined
// CHECK-NEXT: Branch v76 -> taken b15(| 0), notTaken b16(| 0)
// CHECK-NEXT: b15(v77):
// CHECK-NEXT: v78 = Increment v67
// CHECK-NEXT: v79 = Convert v78 declared={type=number}
// CHECK-NEXT: Jump -> next b19(v65, v66, v79, v68)
// CHECK-NEXT: b16(v80):
// CHECK-NEXT: v81 = NarrowByTest v75, v80
// CHECK-NEXT: v82 = StrictEq v66, v68
// CHECK-NEXT: Branch v82 -> taken b17(), notTaken b18(v65, v68)
// CHECK-NEXT: b17():
// CHECK-NEXT: v83 = GetModuleVariable variable=[[g_45]]
// CHECK-NEXT: v84 = Call v83, -, v65, v66 calleeName="moveToLongerArray"
// CHECK-NEXT: v85 = Convert v84 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: v86 = Integer integer=2
// CHECK-NEXT: v87 = Mul v66, v86
// CHECK-NEXT: v88 = Convert v87 declared={type=number}
// CHECK-NEXT: Jump -> next b18(v85, v88)
// CHECK-NEXT: b18(v89: undefined|null|Array, v90: number):
// CHECK-NEXT: v91 = Convert v89 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v92 = Convert v66 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutContiguousIndex v91, v92, v81
// CHECK-NEXT: v94 = Undefined
// CHECK-NEXT: v95 = Integer integer=1
// CHECK-NEXT: v96 = Add v66, v95
// CHECK-NEXT: v97 = Integer
// CHECK-NEXT: v98 = BitOr v96, v97
// CHECK-NEXT: v99 = Convert v98 declared={type=number}
// CHECK-NEXT: Jump -> next b19(v89, v99, v67, v90)
// CHECK-NEXT: b19(v100: undefined|null|Array, v101: number, v102: number, v103: number):
// CHECK-NEXT: v104 = Increment v69
// CHECK-NEXT: v105 = Convert v104 declared={type=number}
// CHECK-NEXT: Jump -> next b12(v100, v101, v102, v103, v105)
// CHECK-NEXT: b20(v106: undefined|null|Array, v107: number, v108: number):
// CHECK-NEXT: v109 = GetModuleVariable variable=[[g_46]]
// CHECK-NEXT: v110 = Call v109, -, v106, v107, v2 calleeName="sortValues"
// CHECK-NEXT: v111 = GetModuleVariable variable=[[g_47]]
// CHECK-NEXT: v112 = Call v111, -, v0, v1, v106, v107, v108 calleeName="putSortedValues"
// CHECK-NEXT: v113 = Undefined
// CHECK-NEXT: Return v113
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="takeValuesOrSort"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_48]]
// CHECK-NEXT: v3 = Call v2, -, v1 calleeName="isCallable"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b8(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = PropGet v0 key="length"
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Less v6, v7
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_43]]
// CHECK-NEXT: v12 = Call v11, -, v0 calleeName="isContiguousArray"
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b5(), notTaken b4(| 0)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_44]]
// CHECK-NEXT: v16 = Call v15, -, v0 calleeName="isDoubleArray"
// CHECK-NEXT: v17 = ToBoolean v16
// CHECK-NEXT: Branch v17 -> taken b5(), notTaken b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: v18 = Convert v6 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v19 = NewContiguousArray v18
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v21 = Convert v20 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v22 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v23 = Convert v6 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v24 = TryCopyFilledElements v21, v22, v23
// CHECK-NEXT: v25 = Convert v24 declared={type=boolean}
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b6(| 0), notTaken b7()
// CHECK-NEXT: b6(v27):
// CHECK-NEXT: Return v20
// CHECK-NEXT: b7():
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_49]]
// CHECK-NEXT: v29 = Call v28, -, v0, v6, v1 calleeName="sortListOfAnyKind"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: Return v31
// CHECK-NEXT: b8(v32):
// CHECK-NEXT: v33 = PropGet v0 key="sort"
// CHECK-NEXT: v34 = Call v33, v0, v1 calleeKey="sort" calleeName="array.sort"
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mergeRunsAndPutBack"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Array flags=[OmitsNull]}, {type=number}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: undefined|null|Array, v2: number, v3: anything):
// CHECK-NEXT: v4 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = NarrowByTest v1, v7
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = BitOr v9, v10
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Add v2, v12
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = BitOr v13, v14
// CHECK-NEXT: v16 = Less v15, v11
// CHECK-NEXT: Branch v16 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_39]]
// CHECK-NEXT: v18 = Call v17, -, v8, v11, v2, v3 calleeName="mergeFurtherValueRuns"
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_47]]
// CHECK-NEXT: v20 = Integer
// CHECK-NEXT: v21 = Call v19, -, v0, v11, v8, v11, v20 calleeName="putSortedValues"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sort"
// CHECK: module=[[m_31]] position={{*}} text={{*}} kind=Method role=Library flags=[HasThis, IsChecked, HasExplicitName] length=1 enclosingRuntimeFunction=ArraySortSort thisType={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} parameters=[{type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_50]]
// CHECK-NEXT: v3 = Call v2, -, v0, v1 calleeName="takeValuesOrSort"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_51]]
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_38]]
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = PropGet v0 key="length"
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = BitOr v7, v8
// CHECK-NEXT: v10 = Call v5, -, v3, v6, v9, v1 calleeName="findValueRun"
// CHECK-NEXT: v11 = Call v4, -, v0, v3, v10, v1 calleeName="mergeRunsAndPutBack"
// CHECK-NEXT: v12 = Convert v0 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isWritableBehindFirstStore"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}, {type=number}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: number, v3: number):
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v6 = Convert v4 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v7 = TryPutIndex v5, v6, v3
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean}
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: v11 = Boolean boolean=true
// CHECK-NEXT: v12 = Convert v11 declared={type=boolean}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: ElemSet v0, v14, v3
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v18 = Convert v16 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v19 = TryPutIndex v17, v18, v3
// CHECK-NEXT: v20 = Convert v19 declared={type=boolean}
// CHECK-NEXT: v21 = ToBoolean v20
// CHECK-NEXT: Branch v21 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v22):
// CHECK-NEXT: v23 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v24 = ArrayStorageKind v23
// CHECK-NEXT: v25 = StrictEq v24, v1
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v27):
// CHECK-NEXT: v28 = PropGet v0 key="length"
// CHECK-NEXT: v29 = StrictEq v28, v2
// CHECK-NEXT: Jump -> next b7(v29)
// CHECK-NEXT: b5(v30):
// CHECK-NEXT: Jump -> next b7(v30)
// CHECK-NEXT: b6(v31):
// CHECK-NEXT: Jump -> next b7(v31)
// CHECK-NEXT: b7(v32):
// CHECK-NEXT: v33 = Convert v32 declared={type=boolean}
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="trySortNumbersInPlace"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=boolean}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: boolean):
// CHECK-NEXT: v2 = Integer integer=64
// CHECK-NEXT: v3 = PropGet v0 key="length"
// CHECK-NEXT: v4 = Integer integer=64
// CHECK-NEXT: v5 = Greater v3, v4
// CHECK-NEXT: Branch v5 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = Boolean
// CHECK-NEXT: v7 = Convert v6 declared={type=boolean}
// CHECK-NEXT: Return v7
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v9 = ArrayStorageKind v8
// CHECK-NEXT: v10 = Integer integer=2
// CHECK-NEXT: v11 = StrictEq v9, v10
// CHECK-NEXT: Branch v11 -> taken b3(), notTaken b20()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v14 = Convert v12 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v15 = GetOwnDoubleIndex v13, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number}
// CHECK-NEXT: v17 = StrictEq v16, v16
// CHECK-NEXT: Branch v17 -> taken b4(), notTaken b19()
// CHECK-NEXT: b4():
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_52]]
// CHECK-NEXT: v19 = Call v18, -, v0, v9, v3, v16 calleeName="isWritableBehindFirstStore"
// CHECK-NEXT: v20 = ToBoolean v19
// CHECK-NEXT: Branch v20 -> taken b5(| 0), notTaken b19()
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = Convert v22 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v23)
// CHECK-NEXT: b6(v24: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v26 = Less v24, v3
// CHECK-NEXT: Branch v26 -> taken b7(), notTaken b18()
// CHECK-NEXT: b7():
// CHECK-NEXT: v27 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v28 = Convert v24 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v29 = GetOwnDoubleIndex v27, v28
// CHECK-NEXT: v30 = Convert v29 declared={type=number}
// CHECK-NEXT: v31 = StrictEq v30, v30
// CHECK-NEXT: Branch v31 -> taken b8(), notTaken b17()
// CHECK-NEXT: b8():
// CHECK-NEXT: v32 = Convert v24 declared={type=number}
// CHECK-NEXT: Jump -> next b9(v32)
// CHECK-NEXT: b9(v33: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v35 = Integer
// CHECK-NEXT: v36 = Greater v33, v35
// CHECK-NEXT: Branch v36 -> taken b10(), notTaken b14()
// CHECK-NEXT: b10():
// CHECK-NEXT: v37 = Integer integer=1
// CHECK-NEXT: v38 = Sub v33, v37
// CHECK-NEXT: v39 = Integer
// CHECK-NEXT: v40 = BitOr v38, v39
// CHECK-NEXT: v41 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v42 = Convert v40 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v43 = GetOwnDoubleIndex v41, v42
// CHECK-NEXT: v44 = Convert v43 declared={type=number}
// CHECK-NEXT: v45 = ToBoolean v1
// CHECK-NEXT: Branch v45 -> taken b11(| 0), notTaken b12(| 0)
// CHECK-NEXT: b11(v46):
// CHECK-NEXT: v47 = Less v44, v30
// CHECK-NEXT: Branch v47 -> taken b13(), notTaken b14()
// CHECK-NEXT: b12(v48):
// CHECK-NEXT: v49 = Less v30, v44
// CHECK-NEXT: Branch v49 -> taken b13(), notTaken b14()
// CHECK-NEXT: b13():
// CHECK-NEXT: v50 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v51 = Convert v33 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v52 = Convert v44 declared={type=number flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnDoubleIndex v50, v51, v52
// CHECK-NEXT: v54 = Undefined
// CHECK-NEXT: v55 = Integer integer=1
// CHECK-NEXT: v56 = Sub v33, v55
// CHECK-NEXT: v57 = Integer
// CHECK-NEXT: v58 = BitOr v56, v57
// CHECK-NEXT: v59 = Convert v58 declared={type=number}
// CHECK-NEXT: Jump -> next b9(v59)
// CHECK-NEXT: b14():
// CHECK-NEXT: v60 = StrictEq v33, v24
// CHECK-NEXT: Branch v60 -> taken b16(), notTaken b15()
// CHECK-NEXT: b15():
// CHECK-NEXT: v61 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v62 = Convert v33 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v63 = Convert v30 declared={type=number flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnDoubleIndex v61, v62, v63
// CHECK-NEXT: v65 = Undefined
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16():
// CHECK-NEXT: v66 = Integer integer=1
// CHECK-NEXT: v67 = Add v24, v66
// CHECK-NEXT: v68 = Integer
// CHECK-NEXT: v69 = BitOr v67, v68
// CHECK-NEXT: v70 = Convert v69 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v70)
// CHECK-NEXT: b17():
// CHECK-NEXT: v71 = Boolean
// CHECK-NEXT: v72 = Convert v71 declared={type=boolean}
// CHECK-NEXT: Return v72
// CHECK-NEXT: b18():
// CHECK-NEXT: v73 = Boolean boolean=true
// CHECK-NEXT: v74 = Convert v73 declared={type=boolean}
// CHECK-NEXT: Return v74
// CHECK-NEXT: b19():
// CHECK-NEXT: v75 = Boolean
// CHECK-NEXT: v76 = Convert v75 declared={type=boolean}
// CHECK-NEXT: Return v76
// CHECK-NEXT: b20():
// CHECK-NEXT: v77 = Integer integer=1
// CHECK-NEXT: v78 = StrictEq v9, v77
// CHECK-NEXT: Branch v78 -> taken b21(), notTaken b38()
// CHECK-NEXT: b21():
// CHECK-NEXT: v79 = Integer
// CHECK-NEXT: v80 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v81 = Convert v79 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v82 = HasContiguousIndex v80, v81
// CHECK-NEXT: v83 = ToBoolean v82
// CHECK-NEXT: Branch v83 -> taken b22(| 0), notTaken b37()
// CHECK-NEXT: b22(v84):
// CHECK-NEXT: v85 = GetModuleVariable variable=[[g_52]]
// CHECK-NEXT: v86 = Integer
// CHECK-NEXT: v87 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v88 = Convert v86 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v89 = GetOwnInt32Index v87, v88
// CHECK-NEXT: v90 = Call v85, -, v0, v9, v3, v89 calleeName="isWritableBehindFirstStore"
// CHECK-NEXT: v91 = ToBoolean v90
// CHECK-NEXT: Branch v91 -> taken b23(| 0), notTaken b37()
// CHECK-NEXT: b23(v92):
// CHECK-NEXT: v93 = Integer integer=1
// CHECK-NEXT: v94 = Convert v93 declared={type=number}
// CHECK-NEXT: Jump -> next b24(v94)
// CHECK-NEXT: b24(v95: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v97 = Less v95, v3
// CHECK-NEXT: Branch v97 -> taken b25(), notTaken b36()
// CHECK-NEXT: b25():
// CHECK-NEXT: v98 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v99 = Convert v95 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v100 = HasContiguousIndex v98, v99
// CHECK-NEXT: v101 = ToBoolean v100
// CHECK-NEXT: Branch v101 -> taken b26(| 0), notTaken b35(| 0)
// CHECK-NEXT: b26(v102):
// CHECK-NEXT: v103 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v104 = Convert v95 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v105 = GetOwnInt32Index v103, v104
// CHECK-NEXT: v106 = Convert v105 declared={type=number}
// CHECK-NEXT: v107 = Convert v95 declared={type=number}
// CHECK-NEXT: Jump -> next b27(v107)
// CHECK-NEXT: b27(v108: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v110 = Integer
// CHECK-NEXT: v111 = Greater v108, v110
// CHECK-NEXT: Branch v111 -> taken b28(), notTaken b32()
// CHECK-NEXT: b28():
// CHECK-NEXT: v112 = Integer integer=1
// CHECK-NEXT: v113 = Sub v108, v112
// CHECK-NEXT: v114 = Integer
// CHECK-NEXT: v115 = BitOr v113, v114
// CHECK-NEXT: v116 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v117 = Convert v115 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v118 = GetOwnInt32Index v116, v117
// CHECK-NEXT: v119 = Convert v118 declared={type=number}
// CHECK-NEXT: v120 = ToBoolean v1
// CHECK-NEXT: Branch v120 -> taken b29(| 0), notTaken b30(| 0)
// CHECK-NEXT: b29(v121):
// CHECK-NEXT: v122 = Less v119, v106
// CHECK-NEXT: Branch v122 -> taken b31(), notTaken b32()
// CHECK-NEXT: b30(v123):
// CHECK-NEXT: v124 = Less v106, v119
// CHECK-NEXT: Branch v124 -> taken b31(), notTaken b32()
// CHECK-NEXT: b31():
// CHECK-NEXT: v125 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v126 = Convert v108 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v127 = Convert v119 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnInt32Index v125, v126, v127
// CHECK-NEXT: v129 = Undefined
// CHECK-NEXT: v130 = Integer integer=1
// CHECK-NEXT: v131 = Sub v108, v130
// CHECK-NEXT: v132 = Integer
// CHECK-NEXT: v133 = BitOr v131, v132
// CHECK-NEXT: v134 = Convert v133 declared={type=number}
// CHECK-NEXT: Jump -> next b27(v134)
// CHECK-NEXT: b32():
// CHECK-NEXT: v135 = StrictEq v108, v95
// CHECK-NEXT: Branch v135 -> taken b34(), notTaken b33()
// CHECK-NEXT: b33():
// CHECK-NEXT: v136 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v137 = Convert v108 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v138 = Convert v106 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnInt32Index v136, v137, v138
// CHECK-NEXT: v140 = Undefined
// CHECK-NEXT: Jump -> next b34()
// CHECK-NEXT: b34():
// CHECK-NEXT: v141 = Integer integer=1
// CHECK-NEXT: v142 = Add v95, v141
// CHECK-NEXT: v143 = Integer
// CHECK-NEXT: v144 = BitOr v142, v143
// CHECK-NEXT: v145 = Convert v144 declared={type=number}
// CHECK-NEXT: Jump -> next b24(v145)
// CHECK-NEXT: b35(v146):
// CHECK-NEXT: v147 = Boolean
// CHECK-NEXT: v148 = Convert v147 declared={type=boolean}
// CHECK-NEXT: Return v148
// CHECK-NEXT: b36():
// CHECK-NEXT: v149 = Boolean boolean=true
// CHECK-NEXT: v150 = Convert v149 declared={type=boolean}
// CHECK-NEXT: Return v150
// CHECK-NEXT: b37():
// CHECK-NEXT: v151 = Boolean
// CHECK-NEXT: v152 = Convert v151 declared={type=boolean}
// CHECK-NEXT: Return v152
// CHECK-NEXT: b38():
// CHECK-NEXT: v153 = Boolean
// CHECK-NEXT: v154 = Convert v153 declared={type=boolean}
// CHECK-NEXT: Return v154
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sortByDifference"
// CHECK: module=[[m_31]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 enclosingRuntimeFunction=ArraySortSortByDifference thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Less v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_53]]
// CHECK-NEXT: v6 = Boolean
// CHECK-NEXT: v7 = Call v5, -, v0, v6 calleeName="trySortNumbersInPlace"
// CHECK-NEXT: v8 = ToBoolean v7
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Convert v0 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_54]]
// CHECK-NEXT: v12 = Call v11, v0, v1
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sortByReversedDifference"
// CHECK: module=[[m_31]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 enclosingRuntimeFunction=ArraySortSortByReversedDifference thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Less v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_53]]
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Call v5, -, v0, v6 calleeName="trySortNumbersInPlace"
// CHECK-NEXT: v8 = ToBoolean v7
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Convert v0 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_54]]
// CHECK-NEXT: v12 = Call v11, v0, v1
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="canSortWhereItLies"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_43]]
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="isContiguousArray"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b9(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v8 = Convert v6 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v9 = GetContiguousIndex v7, v8
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: v12 = Boolean
// CHECK-NEXT: v13 = Convert v12 declared={type=boolean}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = NarrowByTest v9, v14
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v17)
// CHECK-NEXT: b4(v18: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v20 = Less v18, v1
// CHECK-NEXT: Branch v20 -> taken b5(), notTaken b8()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v22 = Convert v18 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v23 = GetContiguousIndex v21, v22
// CHECK-NEXT: v24 = TypeTest v23 testedType=undefined
// CHECK-NEXT: Branch v24 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: v26 = Boolean
// CHECK-NEXT: v27 = Convert v26 declared={type=boolean}
// CHECK-NEXT: Return v27
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: v29 = Integer integer=1
// CHECK-NEXT: v30 = Add v18, v29
// CHECK-NEXT: v31 = Integer
// CHECK-NEXT: v32 = BitOr v30, v31
// CHECK-NEXT: v33 = Convert v32 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v33)
// CHECK-NEXT: b8():
// CHECK-NEXT: v34 = Integer
// CHECK-NEXT: v35 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v36 = Convert v34 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v37 = TryPutIndex v35, v36, v15
// CHECK-NEXT: v38 = Convert v37 declared={type=boolean}
// CHECK-NEXT: Return v38
// CHECK-NEXT: b9(v39):
// CHECK-NEXT: v40 = Boolean
// CHECK-NEXT: v41 = Convert v40 declared={type=boolean}
// CHECK-NEXT: Return v41
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sortWhereNobodySeesTheComparator"
// CHECK: module=[[m_31]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 enclosingRuntimeFunction=ArraySortSortWhereNobodySeesTheComparator thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything):
// CHECK-NEXT: v2 = Integer integer=8
// CHECK-NEXT: v3 = PropGet v0 key="length"
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = BitOr v3, v4
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Less v5, v6
// CHECK-NEXT: Branch v7 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Integer integer=8
// CHECK-NEXT: v10 = GreaterEq v5, v9
// CHECK-NEXT: Branch v10 -> taken b5(), notTaken b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_55]]
// CHECK-NEXT: v12 = Call v11, -, v0, v5 calleeName="canSortWhereItLies"
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b4(| 0), notTaken b5()
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_38]]
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = Call v15, -, v0, v16, v5, v1 calleeName="findValueRun"
// CHECK-NEXT: v18 = Convert v0 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: b5():
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_54]]
// CHECK-NEXT: v20 = Call v19, v0, v1
// CHECK-NEXT: ReturnCall v20 casts=[{declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toSortedListOfOtherStorage"
// CHECK: module=[[m_31]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: anything):
// CHECK-NEXT: v3 = Integer integer=16
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: v5 = Convert v4 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v6 = NewContiguousArray v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = Convert v10 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v4, v7, v9, v11)
// CHECK-NEXT: b1(v12: number, v13: undefined|null|Array, v14: number, v15: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v17 = Less v15, v1
// CHECK-NEXT: Branch v17 -> taken b2(), notTaken b7()
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = ElemGet v0, v15
// CHECK-NEXT: v19 = TypeTest v18 testedType=undefined
// CHECK-NEXT: Branch v19 -> taken b6(v12, v13, v14), notTaken b3(| 0)
// CHECK-NEXT: b3(v20):
// CHECK-NEXT: v21 = NarrowByTest v18, v20
// CHECK-NEXT: v22 = StrictEq v14, v12
// CHECK-NEXT: Branch v22 -> taken b4(), notTaken b5(v13, v12)
// CHECK-NEXT: b4():
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_45]]
// CHECK-NEXT: v24 = Call v23, -, v13, v14 calleeName="moveToLongerArray"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v26 = Integer integer=2
// CHECK-NEXT: v27 = Mul v14, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v25, v28)
// CHECK-NEXT: b5(v29: undefined|null|Array, v30: number):
// CHECK-NEXT: v31 = Convert v29 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v32 = Convert v14 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutContiguousIndex v31, v32, v21
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: v35 = Integer integer=1
// CHECK-NEXT: v36 = Add v14, v35
// CHECK-NEXT: v37 = Integer
// CHECK-NEXT: v38 = BitOr v36, v37
// CHECK-NEXT: v39 = Convert v38 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v30, v29, v39)
// CHECK-NEXT: b6(v40: number, v41: undefined|null|Array, v42: number):
// CHECK-NEXT: v43 = Increment v15
// CHECK-NEXT: v44 = Convert v43 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v40, v41, v42, v44)
// CHECK-NEXT: b7():
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_46]]
// CHECK-NEXT: v46 = Call v45, -, v13, v14, v2 calleeName="sortValues"
// CHECK-NEXT: v47 = LessEq v1, v12
// CHECK-NEXT: Branch v47 -> taken b8(), notTaken b12()
// CHECK-NEXT: b8():
// CHECK-NEXT: v48 = Convert v14 declared={type=number}
// CHECK-NEXT: Jump -> next b9(v48)
// CHECK-NEXT: b9(v49: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v51 = Less v49, v1
// CHECK-NEXT: Branch v51 -> taken b10(), notTaken b11()
// CHECK-NEXT: b10():
// CHECK-NEXT: v52 = Undefined
// CHECK-NEXT: v53 = Convert v13 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v54 = Convert v49 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v53, v54, v52
// CHECK-NEXT: v56 = Undefined
// CHECK-NEXT: v57 = Increment v49
// CHECK-NEXT: v58 = Convert v57 declared={type=number}
// CHECK-NEXT: Jump -> next b9(v58)
// CHECK-NEXT: b11():
// CHECK-NEXT: v59 = Convert v13 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v60 = Convert v1 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v61 = TruncateNewArray v59, v60
// CHECK-NEXT: v62 = Convert v61 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v62
// CHECK-NEXT: b12():
// CHECK-NEXT: v63 = Undefined
// CHECK-NEXT: v64 = Convert v1 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v65 = NewArrayLike v64, v63
// CHECK-NEXT: v66 = Integer
// CHECK-NEXT: v67 = Convert v66 declared={type=number}
// CHECK-NEXT: Jump -> next b13(v67)
// CHECK-NEXT: b13(v68: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v70 = Less v68, v14
// CHECK-NEXT: Branch v70 -> taken b14(), notTaken b15()
// CHECK-NEXT: b14():
// CHECK-NEXT: v71 = Convert v13 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v72 = Convert v68 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v73 = GetOwnContiguousIndex v71, v72
// CHECK-NEXT: ElemSet v65, v68, v73
// CHECK-NEXT: v75 = Increment v68
// CHECK-NEXT: v76 = Convert v75 declared={type=number}
// CHECK-NEXT: Jump -> next b13(v76)
// CHECK-NEXT: b15():
// CHECK-NEXT: v77 = Convert v14 declared={type=number}
// CHECK-NEXT: Jump -> next b16(v77)
// CHECK-NEXT: b16(v78: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v80 = Less v78, v1
// CHECK-NEXT: Branch v80 -> taken b17(), notTaken b18()
// CHECK-NEXT: b17():
// CHECK-NEXT: v81 = Undefined
// CHECK-NEXT: ElemSet v65, v78, v81
// CHECK-NEXT: v83 = Increment v78
// CHECK-NEXT: v84 = Convert v83 declared={type=number}
// CHECK-NEXT: Jump -> next b16(v84)
// CHECK-NEXT: b18():
// CHECK-NEXT: v85 = Convert v65 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: Return v85
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="toSorted"
// CHECK: module=[[m_31]] position={{*}} text={{*}} kind=Method role=Library flags=[HasThis, IsChecked, HasExplicitName] length=1 enclosingRuntimeFunction=ArraySortToSorted thisType={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} parameters=[{type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_48]]
// CHECK-NEXT: v3 = Call v2, -, v1 calleeName="isCallable"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b22(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = PropGet v0 key="length"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_43]]
// CHECK-NEXT: v8 = Call v7, -, v0 calleeName="isContiguousArray"
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b11(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = Convert v6 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v12 = NewContiguousArray v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = Convert v14 declared={type=number}
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v15, v17)
// CHECK-NEXT: b3(v18: number, v19: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v21 = Less v19, v6
// CHECK-NEXT: Branch v21 -> taken b4(), notTaken b7()
// CHECK-NEXT: b4():
// CHECK-NEXT: v22 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v23 = Convert v19 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v24 = GetContiguousIndex v22, v23
// CHECK-NEXT: v25 = TypeTest v24 testedType=undefined
// CHECK-NEXT: Branch v25 -> taken b6(v18), notTaken b5(| 0)
// CHECK-NEXT: b5(v26):
// CHECK-NEXT: v27 = NarrowByTest v24, v26
// CHECK-NEXT: v28 = Convert v13 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v29 = Convert v18 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v28, v29, v27
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: v32 = Integer integer=1
// CHECK-NEXT: v33 = Add v18, v32
// CHECK-NEXT: v34 = Integer
// CHECK-NEXT: v35 = BitOr v33, v34
// CHECK-NEXT: v36 = Convert v35 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v36)
// CHECK-NEXT: b6(v37: number):
// CHECK-NEXT: v38 = Increment v19
// CHECK-NEXT: v39 = Convert v38 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v37, v39)
// CHECK-NEXT: b7():
// CHECK-NEXT: v40 = GetModuleVariable variable=[[g_46]]
// CHECK-NEXT: v41 = Call v40, -, v13, v18, v1 calleeName="sortValues"
// CHECK-NEXT: v42 = Convert v18 declared={type=number}
// CHECK-NEXT: Jump -> next b8(v42)
// CHECK-NEXT: b8(v43: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v45 = Less v43, v6
// CHECK-NEXT: Branch v45 -> taken b9(), notTaken b10()
// CHECK-NEXT: b9():
// CHECK-NEXT: v46 = Undefined
// CHECK-NEXT: v47 = Convert v13 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v48 = Convert v43 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v47, v48, v46
// CHECK-NEXT: v50 = Undefined
// CHECK-NEXT: v51 = Increment v43
// CHECK-NEXT: v52 = Convert v51 declared={type=number}
// CHECK-NEXT: Jump -> next b8(v52)
// CHECK-NEXT: b10():
// CHECK-NEXT: v53 = Convert v13 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v54 = Convert v6 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v55 = TruncateNewArray v53, v54
// CHECK-NEXT: v56 = Convert v55 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v56
// CHECK-NEXT: b11(v57):
// CHECK-NEXT: v58 = GetModuleVariable variable=[[g_44]]
// CHECK-NEXT: v59 = Call v58, -, v0 calleeName="isDoubleArray"
// CHECK-NEXT: v60 = ToBoolean v59
// CHECK-NEXT: Branch v60 -> taken b12(| 0), notTaken b21(| 0)
// CHECK-NEXT: b12(v61):
// CHECK-NEXT: v62 = Convert v6 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v63 = NewContiguousArray v62
// CHECK-NEXT: v64 = Convert v63 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v65 = Integer
// CHECK-NEXT: v66 = Convert v65 declared={type=number}
// CHECK-NEXT: v67 = Integer
// CHECK-NEXT: v68 = Convert v67 declared={type=number}
// CHECK-NEXT: Jump -> next b13(v66, v68)
// CHECK-NEXT: b13(v69: number, v70: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v72 = Less v70, v6
// CHECK-NEXT: Branch v72 -> taken b14(), notTaken b17()
// CHECK-NEXT: b14():
// CHECK-NEXT: v73 = ElemGet v0, v70
// CHECK-NEXT: v74 = TypeTest v73 testedType=undefined
// CHECK-NEXT: Branch v74 -> taken b16(v69), notTaken b15(| 0)
// CHECK-NEXT: b15(v75):
// CHECK-NEXT: v76 = NarrowByTest v73, v75
// CHECK-NEXT: v77 = Convert v64 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v78 = Convert v69 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v77, v78, v76
// CHECK-NEXT: v80 = Undefined
// CHECK-NEXT: v81 = Integer integer=1
// CHECK-NEXT: v82 = Add v69, v81
// CHECK-NEXT: v83 = Integer
// CHECK-NEXT: v84 = BitOr v82, v83
// CHECK-NEXT: v85 = Convert v84 declared={type=number}
// CHECK-NEXT: Jump -> next b16(v85)
// CHECK-NEXT: b16(v86: number):
// CHECK-NEXT: v87 = Increment v70
// CHECK-NEXT: v88 = Convert v87 declared={type=number}
// CHECK-NEXT: Jump -> next b13(v86, v88)
// CHECK-NEXT: b17():
// CHECK-NEXT: v89 = GetModuleVariable variable=[[g_46]]
// CHECK-NEXT: v90 = Call v89, -, v64, v69, v1 calleeName="sortValues"
// CHECK-NEXT: v91 = Convert v69 declared={type=number}
// CHECK-NEXT: Jump -> next b18(v91)
// CHECK-NEXT: b18(v92: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v94 = Less v92, v6
// CHECK-NEXT: Branch v94 -> taken b19(), notTaken b20()
// CHECK-NEXT: b19():
// CHECK-NEXT: v95 = Undefined
// CHECK-NEXT: v96 = Convert v64 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v97 = Convert v92 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: PutOwnContiguousIndex v96, v97, v95
// CHECK-NEXT: v99 = Undefined
// CHECK-NEXT: v100 = Increment v92
// CHECK-NEXT: v101 = Convert v100 declared={type=number}
// CHECK-NEXT: Jump -> next b18(v101)
// CHECK-NEXT: b20():
// CHECK-NEXT: v102 = Convert v64 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v103 = Convert v6 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v104 = TruncateNewArray v102, v103
// CHECK-NEXT: v105 = Convert v104 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v105
// CHECK-NEXT: b21(v106):
// CHECK-NEXT: v107 = GetModuleVariable variable=[[g_56]]
// CHECK-NEXT: v108 = Call v107, -, v0, v6, v1 calleeName="toSortedListOfOtherStorage"
// CHECK-NEXT: ReturnCall v108 casts=[{declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b22(v109):
// CHECK-NEXT: v110 = PropGet v0 key="toSorted"
// CHECK-NEXT: v111 = Call v110, v0, v1 calleeKey="toSorted" calleeName="this.toSorted"
// CHECK-NEXT: ReturnCall v111 casts=[{declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="clampToLength"
// CHECK: module=[[m_57]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number, v1: number):
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Less v0, v2
// CHECK-NEXT: Branch v3 -> taken b1(), notTaken b5()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Add v1, v0
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Less v4, v5
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: Jump -> next b4(v7)
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = URShift v4, v8
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=number}
// CHECK-NEXT: Return v11
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = Less v0, v1
// CHECK-NEXT: Branch v12 -> taken b6(), notTaken b7()
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b8(v0)
// CHECK-NEXT: b7():
// CHECK-NEXT: Jump -> next b8(v1)
// CHECK-NEXT: b8(v13):
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = URShift v13, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storeInNewArray"
// CHECK: module=[[m_57]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: anything):
// CHECK-NEXT: v3 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v4 = Convert v1 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v5 = TryPutByValDirect v3, v4, v2
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean}
// CHECK-NEXT: v7 = ToBoolean v6
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b1(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storeInArrayOfAnyKind"
// CHECK: module=[[m_57]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: anything):
// CHECK-NEXT: v3 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v4 = Convert v1 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v5 = TryPutIndex v3, v4, v2
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean}
// CHECK-NEXT: v7 = ToBoolean v6
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b1(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="appendList"
// CHECK: module=[[m_57]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: undefined|null|Array, v3: number):
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = URShift v1, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: v7 = HasJSType v2
// CHECK-NEXT: v8 = ToBoolean v7
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: v10 = Convert v2 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v11 = ArrayStorageKind v10
// CHECK-NEXT: Jump -> next b3(v11)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = Integer integer=-1
// CHECK-NEXT: Jump -> next b3(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = Convert v15 declared={type=number}
// CHECK-NEXT: v17 = Integer integer=3
// CHECK-NEXT: v18 = StrictEq v14, v17
// CHECK-NEXT: Branch v18 -> taken b5(), notTaken b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = StrictEq v14, v19
// CHECK-NEXT: Branch v20 -> taken b5(), notTaken b11()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Add v6, v3
// CHECK-NEXT: v22 = PropGet v0 key="length"
// CHECK-NEXT: v23 = Greater v21, v22
// CHECK-NEXT: Branch v23 -> taken b6(), notTaken b7()
// CHECK-NEXT: b6():
// CHECK-NEXT: v24 = Add v6, v3
// CHECK-NEXT: v25 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v26 = Convert v24 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: GrowNewArray v25, v26
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Jump -> next b8(v6, v16)
// CHECK-NEXT: b8(v29: number, v30: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v32 = Less v30, v3
// CHECK-NEXT: Branch v32 -> taken b9(), notTaken b19(v29, v30)
// CHECK-NEXT: b9():
// CHECK-NEXT: v33 = Convert v2 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v34 = Convert v30 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v35 = HasContiguousIndex v33, v34
// CHECK-NEXT: v36 = ToBoolean v35
// CHECK-NEXT: Branch v36 -> taken b10(| 0), notTaken b19(v29, v30)
// CHECK-NEXT: b10(v37):
// CHECK-NEXT: v38 = GetModuleVariable variable=[[g_58]]
// CHECK-NEXT: v39 = Convert v2 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v40 = Convert v30 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v41 = GetContiguousIndex v39, v40
// CHECK-NEXT: v42 = Call v38, -, v0, v29, v41 calleeName="storeInArrayOfAnyKind"
// CHECK-NEXT: v43 = Integer integer=1
// CHECK-NEXT: v44 = Add v29, v43
// CHECK-NEXT: v45 = Integer
// CHECK-NEXT: v46 = URShift v44, v45
// CHECK-NEXT: v47 = Convert v46 declared={type=number}
// CHECK-NEXT: v48 = Increment v30
// CHECK-NEXT: v49 = Convert v48 declared={type=number}
// CHECK-NEXT: Jump -> next b8(v47, v49)
// CHECK-NEXT: b11():
// CHECK-NEXT: v50 = Integer integer=2
// CHECK-NEXT: v51 = StrictEq v14, v50
// CHECK-NEXT: Branch v51 -> taken b12(), notTaken b18(v6, v16)
// CHECK-NEXT: b12():
// CHECK-NEXT: v52 = Add v6, v3
// CHECK-NEXT: v53 = PropGet v0 key="length"
// CHECK-NEXT: v54 = Greater v52, v53
// CHECK-NEXT: Branch v54 -> taken b13(), notTaken b14()
// CHECK-NEXT: b13():
// CHECK-NEXT: v55 = Add v6, v3
// CHECK-NEXT: v56 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v57 = Convert v55 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: GrowNewArray v56, v57
// CHECK-NEXT: v59 = Undefined
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: Jump -> next b15(v6, v16)
// CHECK-NEXT: b15(v60: number, v61: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v63 = Less v61, v3
// CHECK-NEXT: Branch v63 -> taken b16(), notTaken b18(v60, v61)
// CHECK-NEXT: b16():
// CHECK-NEXT: v64 = Convert v2 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v65 = Convert v61 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v66 = GetDoubleIndex v64, v65
// CHECK-NEXT: v67 = StrictEq v66, v66
// CHECK-NEXT: Branch v67 -> taken b17(), notTaken b18(v60, v61)
// CHECK-NEXT: b17():
// CHECK-NEXT: v68 = GetModuleVariable variable=[[g_58]]
// CHECK-NEXT: v69 = Call v68, -, v0, v60, v66 calleeName="storeInArrayOfAnyKind"
// CHECK-NEXT: v70 = Integer integer=1
// CHECK-NEXT: v71 = Add v60, v70
// CHECK-NEXT: v72 = Integer
// CHECK-NEXT: v73 = URShift v71, v72
// CHECK-NEXT: v74 = Convert v73 declared={type=number}
// CHECK-NEXT: v75 = Increment v61
// CHECK-NEXT: v76 = Convert v75 declared={type=number}
// CHECK-NEXT: Jump -> next b15(v74, v76)
// CHECK-NEXT: b18(v77: number, v78: number):
// CHECK-NEXT: Jump -> next b19(v77, v78)
// CHECK-NEXT: b19(v79: number, v80: number):
// CHECK-NEXT: Jump -> next b20(v79, v80)
// CHECK-NEXT: b20(v81: number, v82: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v84 = Less v82, v3
// CHECK-NEXT: Branch v84 -> taken b21(), notTaken b26()
// CHECK-NEXT: b21():
// CHECK-NEXT: v85 = ElemHas v2, v82
// CHECK-NEXT: v86 = ToBoolean v85
// CHECK-NEXT: Branch v86 -> taken b22(| 0), notTaken b25(v81)
// CHECK-NEXT: b22(v87):
// CHECK-NEXT: v88 = PropGet v0 key="length"
// CHECK-NEXT: v89 = GreaterEq v81, v88
// CHECK-NEXT: Branch v89 -> taken b23(), notTaken b24()
// CHECK-NEXT: b23():
// CHECK-NEXT: v90 = Convert v0 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v91 = Convert v81 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: GrowNewArray v90, v91
// CHECK-NEXT: v93 = Undefined
// CHECK-NEXT: Jump -> next b24()
// CHECK-NEXT: b24():
// CHECK-NEXT: v94 = GetModuleVariable variable=[[g_58]]
// CHECK-NEXT: v95 = ElemGet v2, v82
// CHECK-NEXT: v96 = Call v94, -, v0, v81, v95 calleeName="storeInArrayOfAnyKind"
// CHECK-NEXT: v97 = Integer integer=1
// CHECK-NEXT: v98 = Add v81, v97
// CHECK-NEXT: v99 = Integer
// CHECK-NEXT: v100 = URShift v98, v99
// CHECK-NEXT: v101 = Convert v100 declared={type=number}
// CHECK-NEXT: Jump -> next b25(v101)
// CHECK-NEXT: b25(v102: number):
// CHECK-NEXT: v103 = Increment v82
// CHECK-NEXT: v104 = Convert v103 declared={type=number}
// CHECK-NEXT: Jump -> next b20(v102, v104)
// CHECK-NEXT: b26():
// CHECK-NEXT: v105 = Convert v81 declared={type=number}
// CHECK-NEXT: Return v105
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="joinedText"
// CHECK: module=[[m_57]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b2(), notTaken b1(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = TypeTest v3 testedType=null
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = String string=""
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: v7 = NarrowByTest v0, v6
// CHECK-NEXT: v8 = ToString v7
// CHECK-NEXT: Jump -> next b4(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="finishJoin"
// CHECK: module=[[m_57]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=number}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|string, v2: number, v3: number):
// CHECK-NEXT: Jump -> next b1(v0, v2)
// CHECK-NEXT: b1(v4: undefined|null|string, v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Add v5, v7
// CHECK-NEXT: v9 = Less v8, v3
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = Add v4, v1
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = Increment v5
// CHECK-NEXT: v13 = Convert v12 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v11, v13)
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="finishReduce"
// CHECK: module=[[m_57]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=boolean}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: boolean, v1: anything):
// CHECK-NEXT: v2 = ToBoolean v0
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: Return v1
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = Builtin builtin=TypeError [isNotReadFromHolder]
// CHECK-NEXT: v6 = String string="reduce of empty array with no initial value"
// CHECK-NEXT: v7 = Construct v5, -, v6 calleeName="TypeError"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|TypeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="traverseArray"
// CHECK: module=[[m_57]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=6 enclosingRuntimeFunction=ArrayTraversalTraverseArray thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=undefined|number}, {type=number}, {type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number, v2: undefined|number, v3: number, v4: undefined|null|Array, v5: anything):
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Integer integer=2
// CHECK-NEXT: v11 = Integer integer=3
// CHECK-NEXT: v12 = Integer integer=4
// CHECK-NEXT: v13 = Integer integer=5
// CHECK-NEXT: v14 = Integer integer=6
// CHECK-NEXT: v15 = Integer integer=7
// CHECK-NEXT: v16 = Integer integer=8
// CHECK-NEXT: v17 = Integer integer=9
// CHECK-NEXT: v18 = Integer integer=15
// CHECK-NEXT: v19 = Integer integer=3
// CHECK-NEXT: v20 = Integer integer=4
// CHECK-NEXT: v21 = Integer integer=6
// CHECK-NEXT: v22 = Integer integer=8
// CHECK-NEXT: v23 = Integer integer=10
// CHECK-NEXT: v24 = Integer integer=11
// CHECK-NEXT: v25 = Integer integer=12
// CHECK-NEXT: v26 = Integer integer=6
// CHECK-NEXT: v27 = Integer integer=3
// CHECK-NEXT: v28 = Integer integer=15
// CHECK-NEXT: v29 = BitAnd v3, v28
// CHECK-NEXT: v30 = Integer integer=4
// CHECK-NEXT: v31 = RShift v3, v30
// CHECK-NEXT: v32 = Integer integer=3
// CHECK-NEXT: v33 = BitAnd v31, v32
// CHECK-NEXT: v34 = Integer integer=6
// CHECK-NEXT: v35 = RShift v3, v34
// CHECK-NEXT: v36 = Integer integer=3
// CHECK-NEXT: v37 = BitAnd v35, v36
// CHECK-NEXT: v38 = Integer integer=8
// CHECK-NEXT: v39 = RShift v3, v38
// CHECK-NEXT: v40 = Integer integer=3
// CHECK-NEXT: v41 = BitAnd v39, v40
// CHECK-NEXT: v42 = Integer integer=2
// CHECK-NEXT: v43 = StrictEq v33, v42
// CHECK-NEXT: v44 = ToBoolean v43
// CHECK-NEXT: Branch v44 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v45):
// CHECK-NEXT: Jump -> next b3(v45)
// CHECK-NEXT: b2(v46):
// CHECK-NEXT: v47 = Integer integer=2
// CHECK-NEXT: v48 = StrictEq v37, v47
// CHECK-NEXT: Jump -> next b3(v48)
// CHECK-NEXT: b3(v49):
// CHECK-NEXT: v50 = ToBoolean v49
// CHECK-NEXT: Branch v50 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v51):
// CHECK-NEXT: Jump -> next b6(v51)
// CHECK-NEXT: b5(v52):
// CHECK-NEXT: v53 = Integer integer=2
// CHECK-NEXT: v54 = StrictEq v41, v53
// CHECK-NEXT: Jump -> next b6(v54)
// CHECK-NEXT: b6(v55):
// CHECK-NEXT: v56 = ToBoolean v55
// CHECK-NEXT: v57 = LogicalNot v56
// CHECK-NEXT: v58 = ToBoolean v57
// CHECK-NEXT: Branch v58 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v59):
// CHECK-NEXT: v60 = Integer integer=6
// CHECK-NEXT: v61 = StrictEq v29, v60
// CHECK-NEXT: v62 = ToBoolean v61
// CHECK-NEXT: Branch v62 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v63):
// CHECK-NEXT: Jump -> next b10(v63)
// CHECK-NEXT: b9(v64):
// CHECK-NEXT: v65 = Integer integer=7
// CHECK-NEXT: v66 = StrictEq v29, v65
// CHECK-NEXT: Jump -> next b10(v66)
// CHECK-NEXT: b10(v67):
// CHECK-NEXT: Jump -> next b12(v67)
// CHECK-NEXT: b11(v68):
// CHECK-NEXT: Jump -> next b12(v68)
// CHECK-NEXT: b12(v69):
// CHECK-NEXT: v70 = Integer integer=6
// CHECK-NEXT: v71 = StrictEq v29, v70
// CHECK-NEXT: v72 = Integer integer=11
// CHECK-NEXT: v73 = RShift v3, v72
// CHECK-NEXT: v74 = Integer integer=1
// CHECK-NEXT: v75 = BitAnd v73, v74
// CHECK-NEXT: v76 = Integer integer=1
// CHECK-NEXT: v77 = StrictEq v75, v76
// CHECK-NEXT: v78 = Integer integer=12
// CHECK-NEXT: v79 = RShift v3, v78
// CHECK-NEXT: v80 = Integer integer=1
// CHECK-NEXT: v81 = BitAnd v79, v80
// CHECK-NEXT: v82 = Integer integer=1
// CHECK-NEXT: v83 = StrictEq v81, v82
// CHECK-NEXT: v84 = Integer integer=6
// CHECK-NEXT: v85 = ElemGet v4, v84
// CHECK-NEXT: v86 = Integer integer=7
// CHECK-NEXT: v87 = ElemGet v4, v86
// CHECK-NEXT: v88 = PropGet v0 key="length"
// CHECK-NEXT: v89 = Integer
// CHECK-NEXT: v90 = StrictEq v1, v89
// CHECK-NEXT: Branch v90 -> taken b13(), notTaken b14()
// CHECK-NEXT: b13():
// CHECK-NEXT: v91 = Integer
// CHECK-NEXT: Jump -> next b15(v91)
// CHECK-NEXT: b14():
// CHECK-NEXT: v92 = GetModuleVariable variable=[[g_59]]
// CHECK-NEXT: v93 = Call v92, -, v1, v88 calleeName="clampToLength"
// CHECK-NEXT: Jump -> next b15(v93)
// CHECK-NEXT: b15(v94):
// CHECK-NEXT: v95 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v95 -> taken b17(v88), notTaken b16(| 0)
// CHECK-NEXT: b16(v96):
// CHECK-NEXT: v97 = NarrowByTest v2, v96
// CHECK-NEXT: v98 = GetModuleVariable variable=[[g_59]]
// CHECK-NEXT: v99 = Call v98, -, v97, v88 calleeName="clampToLength"
// CHECK-NEXT: Jump -> next b17(v99)
// CHECK-NEXT: b17(v100):
// CHECK-NEXT: v101 = Integer
// CHECK-NEXT: v102 = StrictEq v94, v101
// CHECK-NEXT: Branch v102 -> taken b21(v100), notTaken b18()
// CHECK-NEXT: b18():
// CHECK-NEXT: v103 = Greater v100, v94
// CHECK-NEXT: Branch v103 -> taken b19(), notTaken b20()
// CHECK-NEXT: b19():
// CHECK-NEXT: v104 = Sub v100, v94
// CHECK-NEXT: Jump -> next b21(v104)
// CHECK-NEXT: b20():
// CHECK-NEXT: v105 = Integer
// CHECK-NEXT: Jump -> next b21(v105)
// CHECK-NEXT: b21(v106):
// CHECK-NEXT: v107 = Integer
// CHECK-NEXT: v108 = Convert v107 declared={type=number}
// CHECK-NEXT: v109 = Integer
// CHECK-NEXT: v110 = Convert v109 declared={type=number}
// CHECK-NEXT: v111 = Integer
// CHECK-NEXT: v112 = Convert v111 declared={type=number}
// CHECK-NEXT: v113 = Integer
// CHECK-NEXT: v114 = Convert v113 declared={type=number}
// CHECK-NEXT: v115 = Integer integer=10
// CHECK-NEXT: v116 = RShift v3, v115
// CHECK-NEXT: v117 = Integer integer=1
// CHECK-NEXT: v118 = BitAnd v116, v117
// CHECK-NEXT: v119 = Integer integer=1
// CHECK-NEXT: v120 = StrictEq v118, v119
// CHECK-NEXT: v121 = Convert v120 declared={type=boolean}
// CHECK-NEXT: v122 = Integer integer=8
// CHECK-NEXT: v123 = StrictEq v29, v122
// CHECK-NEXT: Branch v123 -> taken b22(), notTaken b24()
// CHECK-NEXT: b22():
// CHECK-NEXT: v124 = TypeTest v5 testedType=string
// CHECK-NEXT: Branch v124 -> taken b23(| 0), notTaken b24()
// CHECK-NEXT: b23(v125):
// CHECK-NEXT: v126 = NarrowByTest v5, v125
// CHECK-NEXT: Jump -> next b25(v126)
// CHECK-NEXT: b24():
// CHECK-NEXT: v127 = String string=","
// CHECK-NEXT: Jump -> next b25(v127)
// CHECK-NEXT: b25(v128):
// CHECK-NEXT: v129 = Convert v128 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v130 = String string=""
// CHECK-NEXT: v131 = Convert v130 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v132 = Boolean
// CHECK-NEXT: v133 = Convert v132 declared={type=boolean}
// CHECK-NEXT: v134 = Undefined
// CHECK-NEXT: v135 = Integer integer=-1
// CHECK-NEXT: v136 = Convert v135 declared={type=number}
// CHECK-NEXT: v137 = Undefined
// CHECK-NEXT: v138 = Convert v137 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: v139 = Integer
// CHECK-NEXT: v140 = StrictEq v29, v139
// CHECK-NEXT: Branch v140 -> taken b26(), notTaken b28()
// CHECK-NEXT: b26():
// CHECK-NEXT: v141 = ToBoolean v55
// CHECK-NEXT: Branch v141 -> taken b28(), notTaken b27(| 0)
// CHECK-NEXT: b27(v142):
// CHECK-NEXT: v143 = Convert v106 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v144 = NewArrayLike v143, v0
// CHECK-NEXT: v145 = Convert v144 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b34(v145)
// CHECK-NEXT: b28():
// CHECK-NEXT: v146 = Integer
// CHECK-NEXT: v147 = StrictEq v29, v146
// CHECK-NEXT: Branch v147 -> taken b29(), notTaken b30()
// CHECK-NEXT: b29():
// CHECK-NEXT: v148 = Convert v106 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v149 = NewArrayWithCapacity v148, v0
// CHECK-NEXT: v150 = Convert v149 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b33(v150)
// CHECK-NEXT: b30():
// CHECK-NEXT: v151 = Integer integer=9
// CHECK-NEXT: v152 = StrictEq v29, v151
// CHECK-NEXT: Branch v152 -> taken b31(), notTaken b32(v138)
// CHECK-NEXT: b31():
// CHECK-NEXT: v153 = Add v106, v106
// CHECK-NEXT: v154 = Integer
// CHECK-NEXT: v155 = URShift v153, v154
// CHECK-NEXT: v156 = Convert v155 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v157 = NewArrayWithCapacity v156, v0
// CHECK-NEXT: v158 = Convert v157 declared={type=undefined|null|Array flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b32(v158)
// CHECK-NEXT: b32(v159: undefined|null|Array):
// CHECK-NEXT: Jump -> next b33(v159)
// CHECK-NEXT: b33(v160: undefined|null|Array):
// CHECK-NEXT: Jump -> next b34(v160)
// CHECK-NEXT: b34(v161: undefined|null|Array):
// CHECK-NEXT: v162 = Convert v94 declared={type=number}
// CHECK-NEXT: Jump -> next b35(v108, v110, v112, v114, v5, v121, v131, v133, v134, v136, v162)
// CHECK-NEXT: b35(v163: number, v164: number, v165: number, v166: number, v167, v168: boolean, v169: undefined|null|string, v170: boolean, v171, v172: number, v173: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: Jump -> next b36(v163, v164, v165, v166, v167, v168, v169, v170, v171, v172, v173)
// CHECK-NEXT: b36(v175: number, v176: number, v177: number, v178: number, v179, v180: boolean, v181: undefined|null|string, v182: boolean, v183, v184: number, v185: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v187 = Less v185, v100
// CHECK-NEXT: Branch v187 -> taken b37(), notTaken b141()
// CHECK-NEXT: b37():
// CHECK-NEXT: v188 = Sub v185, v94
// CHECK-NEXT: v189 = Convert v188 declared={type=number}
// CHECK-NEXT: v190 = ElemHas v0, v185
// CHECK-NEXT: v191 = ToBoolean v190
// CHECK-NEXT: Branch v191 -> taken b38(| 0), notTaken b130(| 0)
// CHECK-NEXT: b38(v192):
// CHECK-NEXT: v193 = ElemGet v0, v185
// CHECK-NEXT: v194 = Integer integer=1
// CHECK-NEXT: v195 = StrictEq v33, v194
// CHECK-NEXT: Branch v195 -> taken b39(), notTaken b40()
// CHECK-NEXT: b39():
// CHECK-NEXT: v196 = Integer
// CHECK-NEXT: v197 = ElemGet v4, v196
// CHECK-NEXT: v198 = Integer integer=1
// CHECK-NEXT: v199 = ElemGet v4, v198
// CHECK-NEXT: v200 = Call v197, v199, v193, v189, v0
// CHECK-NEXT: Jump -> next b44(v200, v189, v175)
// CHECK-NEXT: b40():
// CHECK-NEXT: v201 = Integer integer=2
// CHECK-NEXT: v202 = StrictEq v33, v201
// CHECK-NEXT: Branch v202 -> taken b41(), notTaken b43(v189, v175)
// CHECK-NEXT: b41():
// CHECK-NEXT: v203 = Integer
// CHECK-NEXT: v204 = ElemGet v4, v203
// CHECK-NEXT: v205 = Integer integer=1
// CHECK-NEXT: v206 = ElemGet v4, v205
// CHECK-NEXT: v207 = Call v204, v206, v193, v189, v0
// CHECK-NEXT: v208 = ToBoolean v207
// CHECK-NEXT: Branch v208 -> taken b42(| 0), notTaken b140(v175, v176, v177, v178, v179, v180, v181, v182, v183, v184)
// CHECK-NEXT: b42(v209):
// CHECK-NEXT: v210 = Convert v175 declared={type=number}
// CHECK-NEXT: v211 = Integer integer=1
// CHECK-NEXT: v212 = Add v210, v211
// CHECK-NEXT: v213 = Integer
// CHECK-NEXT: v214 = URShift v212, v213
// CHECK-NEXT: v215 = Convert v214 declared={type=number}
// CHECK-NEXT: Jump -> next b43(v210, v215)
// CHECK-NEXT: b43(v216: number, v217: number):
// CHECK-NEXT: Jump -> next b44(v193, v216, v217)
// CHECK-NEXT: b44(v218, v219: number, v220: number):
// CHECK-NEXT: v221 = Integer integer=1
// CHECK-NEXT: v222 = StrictEq v37, v221
// CHECK-NEXT: Branch v222 -> taken b45(), notTaken b46()
// CHECK-NEXT: b45():
// CHECK-NEXT: v223 = Integer integer=2
// CHECK-NEXT: v224 = ElemGet v4, v223
// CHECK-NEXT: v225 = Integer integer=3
// CHECK-NEXT: v226 = ElemGet v4, v225
// CHECK-NEXT: v227 = Call v224, v226, v218, v219, v0
// CHECK-NEXT: Jump -> next b50(v227, v219, v176)
// CHECK-NEXT: b46():
// CHECK-NEXT: v228 = Integer integer=2
// CHECK-NEXT: v229 = StrictEq v37, v228
// CHECK-NEXT: Branch v229 -> taken b47(), notTaken b49(v219, v176)
// CHECK-NEXT: b47():
// CHECK-NEXT: v230 = Integer integer=2
// CHECK-NEXT: v231 = ElemGet v4, v230
// CHECK-NEXT: v232 = Integer integer=3
// CHECK-NEXT: v233 = ElemGet v4, v232
// CHECK-NEXT: v234 = Call v231, v233, v218, v219, v0
// CHECK-NEXT: v235 = ToBoolean v234
// CHECK-NEXT: Branch v235 -> taken b48(| 0), notTaken b140(v220, v176, v177, v178, v179, v180, v181, v182, v183, v184)
// CHECK-NEXT: b48(v236):
// CHECK-NEXT: v237 = Convert v176 declared={type=number}
// CHECK-NEXT: v238 = Integer integer=1
// CHECK-NEXT: v239 = Add v237, v238
// CHECK-NEXT: v240 = Integer
// CHECK-NEXT: v241 = URShift v239, v240
// CHECK-NEXT: v242 = Convert v241 declared={type=number}
// CHECK-NEXT: Jump -> next b49(v237, v242)
// CHECK-NEXT: b49(v243: number, v244: number):
// CHECK-NEXT: Jump -> next b50(v218, v243, v244)
// CHECK-NEXT: b50(v245, v246: number, v247: number):
// CHECK-NEXT: v248 = Integer integer=1
// CHECK-NEXT: v249 = StrictEq v41, v248
// CHECK-NEXT: Branch v249 -> taken b51(), notTaken b52()
// CHECK-NEXT: b51():
// CHECK-NEXT: v250 = Integer integer=4
// CHECK-NEXT: v251 = ElemGet v4, v250
// CHECK-NEXT: v252 = Integer integer=5
// CHECK-NEXT: v253 = ElemGet v4, v252
// CHECK-NEXT: v254 = Call v251, v253, v245, v246, v0
// CHECK-NEXT: Jump -> next b56(v246, v254, v177)
// CHECK-NEXT: b52():
// CHECK-NEXT: v255 = Integer integer=2
// CHECK-NEXT: v256 = StrictEq v41, v255
// CHECK-NEXT: Branch v256 -> taken b53(), notTaken b55(v246, v177)
// CHECK-NEXT: b53():
// CHECK-NEXT: v257 = Integer integer=4
// CHECK-NEXT: v258 = ElemGet v4, v257
// CHECK-NEXT: v259 = Integer integer=5
// CHECK-NEXT: v260 = ElemGet v4, v259
// CHECK-NEXT: v261 = Call v258, v260, v245, v246, v0
// CHECK-NEXT: v262 = ToBoolean v261
// CHECK-NEXT: Branch v262 -> taken b54(| 0), notTaken b140(v220, v247, v177, v178, v179, v180, v181, v182, v183, v184)
// CHECK-NEXT: b54(v263):
// CHECK-NEXT: v264 = Convert v177 declared={type=number}
// CHECK-NEXT: v265 = Integer integer=1
// CHECK-NEXT: v266 = Add v264, v265
// CHECK-NEXT: v267 = Integer
// CHECK-NEXT: v268 = URShift v266, v267
// CHECK-NEXT: v269 = Convert v268 declared={type=number}
// CHECK-NEXT: Jump -> next b55(v264, v269)
// CHECK-NEXT: b55(v270: number, v271: number):
// CHECK-NEXT: Jump -> next b56(v270, v245, v271)
// CHECK-NEXT: b56(v272: number, v273, v274: number):
// CHECK-NEXT: v275 = ToBoolean v83
// CHECK-NEXT: Branch v275 -> taken b57(| 0), notTaken b58()
// CHECK-NEXT: b57(v276):
// CHECK-NEXT: v277 = ToBoolean v182
// CHECK-NEXT: Branch v277 -> taken b140(v220, v247, v274, v178, v179, v180, v181, v182, v183, v184), notTaken b58()
// CHECK-NEXT: b58():
// CHECK-NEXT: v278 = Integer
// CHECK-NEXT: v279 = StrictEq v29, v278
// CHECK-NEXT: Branch v279 -> taken b59(), notTaken b61()
// CHECK-NEXT: b59():
// CHECK-NEXT: v280 = Convert v161 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v281 = Convert v272 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v282 = TryPutByValDirect v280, v281, v273
// CHECK-NEXT: v283 = Convert v282 declared={type=boolean}
// CHECK-NEXT: v284 = ToBoolean v283
// CHECK-NEXT: Branch v284 -> taken b125(v178, v179, v180, v181, v182, v183, v184), notTaken b60(| 0)
// CHECK-NEXT: b60(v285):
// CHECK-NEXT: ElemSet v161, v272, v273
// CHECK-NEXT: v287 = Integer integer=1
// CHECK-NEXT: v288 = Add v185, v287
// CHECK-NEXT: v289 = Integer
// CHECK-NEXT: v290 = URShift v288, v289
// CHECK-NEXT: v291 = Convert v290 declared={type=number}
// CHECK-NEXT: Jump -> next b35(v220, v247, v274, v178, v179, v180, v181, v182, v183, v184, v291)
// CHECK-NEXT: b61():
// CHECK-NEXT: v292 = Integer integer=1
// CHECK-NEXT: v293 = StrictEq v29, v292
// CHECK-NEXT: Branch v293 -> taken b140(v220, v247, v274, v178, v179, v180, v181, v182, v183, v184), notTaken b62()
// CHECK-NEXT: b62():
// CHECK-NEXT: v294 = Integer integer=2
// CHECK-NEXT: v295 = StrictEq v29, v294
// CHECK-NEXT: Branch v295 -> taken b63(), notTaken b64()
// CHECK-NEXT: b63():
// CHECK-NEXT: v296 = Call v85, v87, v273, v272, v0
// CHECK-NEXT: Jump -> next b124(v178, v179, v180, v181, v182, v183, v184)
// CHECK-NEXT: b64():
// CHECK-NEXT: v297 = Integer integer=3
// CHECK-NEXT: v298 = StrictEq v29, v297
// CHECK-NEXT: Branch v298 -> taken b65(), notTaken b71()
// CHECK-NEXT: b65():
// CHECK-NEXT: v299 = ToBoolean v120
// CHECK-NEXT: Branch v299 -> taken b66(| 0), notTaken b67(| 0)
// CHECK-NEXT: b66(v300):
// CHECK-NEXT: v301 = Undefined
// CHECK-NEXT: v302 = Call v85, v301, v179, v273, v272, v0
// CHECK-NEXT: Jump -> next b70(v302, v180)
// CHECK-NEXT: b67(v303):
// CHECK-NEXT: v304 = ToBoolean v180
// CHECK-NEXT: Branch v304 -> taken b68(| 0), notTaken b69(v273)
// CHECK-NEXT: b68(v305):
// CHECK-NEXT: v306 = Undefined
// CHECK-NEXT: v307 = Call v85, v306, v179, v273, v272, v0
// CHECK-NEXT: Jump -> next b69(v307)
// CHECK-NEXT: b69(v308):
// CHECK-NEXT: v309 = Boolean boolean=true
// CHECK-NEXT: v310 = Convert v309 declared={type=boolean}
// CHECK-NEXT: Jump -> next b70(v308, v310)
// CHECK-NEXT: b70(v311, v312: boolean):
// CHECK-NEXT: Jump -> next b123(v178, v311, v312, v181, v182, v183, v184)
// CHECK-NEXT: b71():
// CHECK-NEXT: v313 = Integer integer=4
// CHECK-NEXT: v314 = StrictEq v29, v313
// CHECK-NEXT: Branch v314 -> taken b72(), notTaken b77()
// CHECK-NEXT: b72():
// CHECK-NEXT: v315 = Call v85, v87, v273, v272, v0
// CHECK-NEXT: v316 = ToBoolean v315
// CHECK-NEXT: Branch v316 -> taken b73(| 0), notTaken b76(v182)
// CHECK-NEXT: b73(v317):
// CHECK-NEXT: v318 = ToBoolean v83
// CHECK-NEXT: Branch v318 -> taken b74(| 0), notTaken b75(| 0)
// CHECK-NEXT: b74(v319):
// CHECK-NEXT: v320 = Boolean boolean=true
// CHECK-NEXT: v321 = Convert v320 declared={type=boolean}
// CHECK-NEXT: Jump -> next b76(v321)
// CHECK-NEXT: b75(v322):
// CHECK-NEXT: v323 = Boolean boolean=true
// CHECK-NEXT: Return v323
// CHECK-NEXT: b76(v324: boolean):
// CHECK-NEXT: Jump -> next b122(v178, v181, v324, v183, v184)
// CHECK-NEXT: b77():
// CHECK-NEXT: v325 = Integer integer=5
// CHECK-NEXT: v326 = StrictEq v29, v325
// CHECK-NEXT: Branch v326 -> taken b78(), notTaken b83()
// CHECK-NEXT: b78():
// CHECK-NEXT: v327 = Call v85, v87, v273, v272, v0
// CHECK-NEXT: v328 = ToBoolean v327
// CHECK-NEXT: Branch v328 -> taken b81(v182), notTaken b79(| 0)
// CHECK-NEXT: b79(v329):
// CHECK-NEXT: v330 = ToBoolean v83
// CHECK-NEXT: Branch v330 -> taken b80(| 0), notTaken b82(| 0)
// CHECK-NEXT: b80(v331):
// CHECK-NEXT: v332 = Boolean boolean=true
// CHECK-NEXT: v333 = Convert v332 declared={type=boolean}
// CHECK-NEXT: Jump -> next b81(v333)
// CHECK-NEXT: b81(v334: boolean):
// CHECK-NEXT: Jump -> next b121(v178, v181, v334, v183, v184)
// CHECK-NEXT: b82(v335):
// CHECK-NEXT: v336 = Boolean
// CHECK-NEXT: Return v336
// CHECK-NEXT: b83():
// CHECK-NEXT: v337 = Integer integer=6
// CHECK-NEXT: v338 = StrictEq v29, v337
// CHECK-NEXT: Branch v338 -> taken b84(), notTaken b89()
// CHECK-NEXT: b84():
// CHECK-NEXT: v339 = Call v85, v87, v273, v272, v0
// CHECK-NEXT: v340 = ToBoolean v339
// CHECK-NEXT: Branch v340 -> taken b85(| 0), notTaken b88(v182, v183)
// CHECK-NEXT: b85(v341):
// CHECK-NEXT: v342 = ToBoolean v83
// CHECK-NEXT: Branch v342 -> taken b86(| 0), notTaken b87(| 0)
// CHECK-NEXT: b86(v343):
// CHECK-NEXT: v344 = Boolean boolean=true
// CHECK-NEXT: v345 = Convert v344 declared={type=boolean}
// CHECK-NEXT: Jump -> next b88(v345, v273)
// CHECK-NEXT: b87(v346):
// CHECK-NEXT: Return v273
// CHECK-NEXT: b88(v347: boolean, v348):
// CHECK-NEXT: Jump -> next b120(v178, v181, v347, v348, v184)
// CHECK-NEXT: b89():
// CHECK-NEXT: v349 = Integer integer=7
// CHECK-NEXT: v350 = StrictEq v29, v349
// CHECK-NEXT: Branch v350 -> taken b90(), notTaken b95()
// CHECK-NEXT: b90():
// CHECK-NEXT: v351 = Call v85, v87, v273, v272, v0
// CHECK-NEXT: v352 = ToBoolean v351
// CHECK-NEXT: Branch v352 -> taken b91(| 0), notTaken b94(v182, v184)
// CHECK-NEXT: b91(v353):
// CHECK-NEXT: v354 = ToBoolean v83
// CHECK-NEXT: Branch v354 -> taken b92(| 0), notTaken b93(| 0)
// CHECK-NEXT: b92(v355):
// CHECK-NEXT: v356 = Boolean boolean=true
// CHECK-NEXT: v357 = Convert v356 declared={type=boolean}
// CHECK-NEXT: v358 = Convert v272 declared={type=number}
// CHECK-NEXT: Jump -> next b94(v357, v358)
// CHECK-NEXT: b93(v359):
// CHECK-NEXT: Return v272
// CHECK-NEXT: b94(v360: boolean, v361: number):
// CHECK-NEXT: Jump -> next b119(v178, v181, v360, v361)
// CHECK-NEXT: b95():
// CHECK-NEXT: v362 = Integer integer=8
// CHECK-NEXT: v363 = StrictEq v29, v362
// CHECK-NEXT: Branch v363 -> taken b96(), notTaken b100()
// CHECK-NEXT: b96():
// CHECK-NEXT: Jump -> next b97(v178, v181)
// CHECK-NEXT: b97(v364: number, v365: undefined|null|string):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v367 = Less v364, v272
// CHECK-NEXT: Branch v367 -> taken b98(), notTaken b99()
// CHECK-NEXT: b98():
// CHECK-NEXT: v368 = Add v365, v129
// CHECK-NEXT: v369 = Convert v368 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v370 = Increment v364
// CHECK-NEXT: v371 = Convert v370 declared={type=number}
// CHECK-NEXT: Jump -> next b97(v371, v369)
// CHECK-NEXT: b99():
// CHECK-NEXT: v372 = GetModuleVariable variable=[[g_60]]
// CHECK-NEXT: v373 = Call v372, -, v273 calleeName="joinedText"
// CHECK-NEXT: v374 = Add v365, v373
// CHECK-NEXT: v375 = Convert v374 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b118(v364, v375)
// CHECK-NEXT: b100():
// CHECK-NEXT: v376 = Call v85, v87, v273, v272, v0
// CHECK-NEXT: v377 = Builtin builtin=ArrayIsArray [isNotReadFromHolder]
// CHECK-NEXT: v378 = TypeTest v376 testedType=Array
// CHECK-NEXT: Branch v378 -> taken b101(| 0), notTaken b102(| 0)
// CHECK-NEXT: b101(v379):
// CHECK-NEXT: Jump -> next b103(v379)
// CHECK-NEXT: b102(v380):
// CHECK-NEXT: v381 = NarrowByTest v376, v380
// CHECK-NEXT: v382 = Builtin builtin=ArrayIsArray [isNotReadFromHolder]
// CHECK-NEXT: v383 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v384 = Call v382, v383, v381
// CHECK-NEXT: v385 = ToBoolean v384
// CHECK-NEXT: Branch v385 -> taken b103(v380), notTaken b127(| 0)
// CHECK-NEXT: b103(v386):
// CHECK-NEXT: v387 = NarrowByTest v376, v386
// CHECK-NEXT: v388 = PropGet v387 key="length"
// CHECK-NEXT: v389 = ToLength v388
// CHECK-NEXT: v390 = Integer
// CHECK-NEXT: v391 = StrictEq v389, v390
// CHECK-NEXT: Branch v391 -> taken b140(v220, v247, v274, v178, v179, v180, v181, v182, v183, v184), notTaken b104()
// CHECK-NEXT: b104():
// CHECK-NEXT: v392 = ToBoolean v77
// CHECK-NEXT: Branch v392 -> taken b105(| 0), notTaken b126()
// CHECK-NEXT: b105(v393):
// CHECK-NEXT: v394 = Integer integer=3
// CHECK-NEXT: v395 = Greater v389, v394
// CHECK-NEXT: Branch v395 -> taken b126(), notTaken b106()
// CHECK-NEXT: b106():
// CHECK-NEXT: v396 = Add v178, v389
// CHECK-NEXT: v397 = PropGet v161 key="length"
// CHECK-NEXT: v398 = Greater v396, v397
// CHECK-NEXT: Branch v398 -> taken b107(), notTaken b108()
// CHECK-NEXT: b107():
// CHECK-NEXT: v399 = Add v178, v389
// CHECK-NEXT: v400 = Convert v161 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v401 = Convert v399 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: GrowNewArray v400, v401
// CHECK-NEXT: v403 = Undefined
// CHECK-NEXT: Jump -> next b108()
// CHECK-NEXT: b108():
// CHECK-NEXT: v404 = Integer
// CHECK-NEXT: v405 = Greater v389, v404
// CHECK-NEXT: Branch v405 -> taken b109(), notTaken b111(v178)
// CHECK-NEXT: b109():
// CHECK-NEXT: v406 = Integer
// CHECK-NEXT: v407 = ElemHas v387, v406
// CHECK-NEXT: v408 = ToBoolean v407
// CHECK-NEXT: Branch v408 -> taken b110(| 0), notTaken b111(v178)
// CHECK-NEXT: b110(v409):
// CHECK-NEXT: v410 = GetModuleVariable variable=[[g_61]]
// CHECK-NEXT: v411 = Integer
// CHECK-NEXT: v412 = ElemGet v387, v411
// CHECK-NEXT: v413 = Call v410, -, v161, v178, v412 calleeName="storeInNewArray"
// CHECK-NEXT: v414 = Integer integer=1
// CHECK-NEXT: v415 = Add v178, v414
// CHECK-NEXT: v416 = Integer
// CHECK-NEXT: v417 = URShift v415, v416
// CHECK-NEXT: v418 = Convert v417 declared={type=number}
// CHECK-NEXT: Jump -> next b111(v418)
// CHECK-NEXT: b111(v419: number):
// CHECK-NEXT: v420 = Integer integer=1
// CHECK-NEXT: v421 = Greater v389, v420
// CHECK-NEXT: Branch v421 -> taken b112(), notTaken b114(v419)
// CHECK-NEXT: b112():
// CHECK-NEXT: v422 = Integer integer=1
// CHECK-NEXT: v423 = ElemHas v387, v422
// CHECK-NEXT: v424 = ToBoolean v423
// CHECK-NEXT: Branch v424 -> taken b113(| 0), notTaken b114(v419)
// CHECK-NEXT: b113(v425):
// CHECK-NEXT: v426 = GetModuleVariable variable=[[g_61]]
// CHECK-NEXT: v427 = Integer integer=1
// CHECK-NEXT: v428 = ElemGet v387, v427
// CHECK-NEXT: v429 = Call v426, -, v161, v419, v428 calleeName="storeInNewArray"
// CHECK-NEXT: v430 = Integer integer=1
// CHECK-NEXT: v431 = Add v419, v430
// CHECK-NEXT: v432 = Integer
// CHECK-NEXT: v433 = URShift v431, v432
// CHECK-NEXT: v434 = Convert v433 declared={type=number}
// CHECK-NEXT: Jump -> next b114(v434)
// CHECK-NEXT: b114(v435: number):
// CHECK-NEXT: v436 = Integer integer=2
// CHECK-NEXT: v437 = Greater v389, v436
// CHECK-NEXT: Branch v437 -> taken b115(), notTaken b117(v435)
// CHECK-NEXT: b115():
// CHECK-NEXT: v438 = Integer integer=2
// CHECK-NEXT: v439 = ElemHas v387, v438
// CHECK-NEXT: v440 = ToBoolean v439
// CHECK-NEXT: Branch v440 -> taken b116(| 0), notTaken b117(v435)
// CHECK-NEXT: b116(v441):
// CHECK-NEXT: v442 = GetModuleVariable variable=[[g_61]]
// CHECK-NEXT: v443 = Integer integer=2
// CHECK-NEXT: v444 = ElemGet v387, v443
// CHECK-NEXT: v445 = Call v442, -, v161, v435, v444 calleeName="storeInNewArray"
// CHECK-NEXT: v446 = Integer integer=1
// CHECK-NEXT: v447 = Add v435, v446
// CHECK-NEXT: v448 = Integer
// CHECK-NEXT: v449 = URShift v447, v448
// CHECK-NEXT: v450 = Convert v449 declared={type=number}
// CHECK-NEXT: Jump -> next b117(v450)
// CHECK-NEXT: b117(v451: number):
// CHECK-NEXT: Jump -> next b118(v451, v181)
// CHECK-NEXT: b118(v452: number, v453: undefined|null|string):
// CHECK-NEXT: Jump -> next b119(v452, v453, v182, v184)
// CHECK-NEXT: b119(v454: number, v455: undefined|null|string, v456: boolean, v457: number):
// CHECK-NEXT: Jump -> next b120(v454, v455, v456, v183, v457)
// CHECK-NEXT: b120(v458: number, v459: undefined|null|string, v460: boolean, v461, v462: number):
// CHECK-NEXT: Jump -> next b121(v458, v459, v460, v461, v462)
// CHECK-NEXT: b121(v463: number, v464: undefined|null|string, v465: boolean, v466, v467: number):
// CHECK-NEXT: Jump -> next b122(v463, v464, v465, v466, v467)
// CHECK-NEXT: b122(v468: number, v469: undefined|null|string, v470: boolean, v471, v472: number):
// CHECK-NEXT: Jump -> next b123(v468, v179, v180, v469, v470, v471, v472)
// CHECK-NEXT: b123(v473: number, v474, v475: boolean, v476: undefined|null|string, v477: boolean, v478, v479: number):
// CHECK-NEXT: Jump -> next b124(v473, v474, v475, v476, v477, v478, v479)
// CHECK-NEXT: b124(v480: number, v481, v482: boolean, v483: undefined|null|string, v484: boolean, v485, v486: number):
// CHECK-NEXT: Jump -> next b125(v480, v481, v482, v483, v484, v485, v486)
// CHECK-NEXT: b125(v487: number, v488, v489: boolean, v490: undefined|null|string, v491: boolean, v492, v493: number):
// CHECK-NEXT: Jump -> next b140(v220, v247, v274, v487, v488, v489, v490, v491, v492, v493)
// CHECK-NEXT: b126():
// CHECK-NEXT: v494 = GetModuleVariable variable=[[g_62]]
// CHECK-NEXT: v495 = Call v494, -, v161, v178, v387, v389 calleeName="appendList"
// CHECK-NEXT: v496 = Convert v495 declared={type=number}
// CHECK-NEXT: Jump -> next b140(v220, v247, v274, v496, v179, v180, v181, v182, v183, v184)
// CHECK-NEXT: b127(v497):
// CHECK-NEXT: v498 = PropGet v161 key="length"
// CHECK-NEXT: v499 = GreaterEq v178, v498
// CHECK-NEXT: Branch v499 -> taken b128(), notTaken b129()
// CHECK-NEXT: b128():
// CHECK-NEXT: v500 = Convert v161 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v501 = Convert v178 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: GrowNewArray v500, v501
// CHECK-NEXT: v503 = Undefined
// CHECK-NEXT: Jump -> next b129()
// CHECK-NEXT: b129():
// CHECK-NEXT: v504 = GetModuleVariable variable=[[g_61]]
// CHECK-NEXT: v505 = Call v504, -, v161, v178, v381 calleeName="storeInNewArray"
// CHECK-NEXT: v506 = Integer integer=1
// CHECK-NEXT: v507 = Add v178, v506
// CHECK-NEXT: v508 = Integer
// CHECK-NEXT: v509 = URShift v507, v508
// CHECK-NEXT: v510 = Convert v509 declared={type=number}
// CHECK-NEXT: Jump -> next b140(v220, v247, v274, v510, v179, v180, v181, v182, v183, v184)
// CHECK-NEXT: b130(v511):
// CHECK-NEXT: v512 = ToBoolean v69
// CHECK-NEXT: Branch v512 -> taken b131(| 0), notTaken b139(v182, v184)
// CHECK-NEXT: b131(v513):
// CHECK-NEXT: v514 = ToBoolean v83
// CHECK-NEXT: Branch v514 -> taken b132(| 0), notTaken b133()
// CHECK-NEXT: b132(v515):
// CHECK-NEXT: v516 = ToBoolean v182
// CHECK-NEXT: Branch v516 -> taken b139(v182, v184), notTaken b133()
// CHECK-NEXT: b133():
// CHECK-NEXT: v517 = Undefined
// CHECK-NEXT: v518 = Call v85, v87, v517, v189, v0
// CHECK-NEXT: v519 = ToBoolean v518
// CHECK-NEXT: Branch v519 -> taken b134(| 0), notTaken b139(v182, v184)
// CHECK-NEXT: b134(v520):
// CHECK-NEXT: v521 = ToBoolean v83
// CHECK-NEXT: Branch v521 -> taken b135(| 0), notTaken b136(| 0)
// CHECK-NEXT: b135(v522):
// CHECK-NEXT: v523 = Boolean boolean=true
// CHECK-NEXT: v524 = Convert v523 declared={type=boolean}
// CHECK-NEXT: Jump -> next b139(v524, v189)
// CHECK-NEXT: b136(v525):
// CHECK-NEXT: v526 = ToBoolean v71
// CHECK-NEXT: Branch v526 -> taken b137(| 0), notTaken b138(v189)
// CHECK-NEXT: b137(v527):
// CHECK-NEXT: v528 = Undefined
// CHECK-NEXT: Jump -> next b138(v528)
// CHECK-NEXT: b138(v529):
// CHECK-NEXT: Return v529
// CHECK-NEXT: b139(v530: boolean, v531: number):
// CHECK-NEXT: Jump -> next b140(v175, v176, v177, v178, v179, v180, v181, v530, v183, v531)
// CHECK-NEXT: b140(v532: number, v533: number, v534: number, v535: number, v536, v537: boolean, v538: undefined|null|string, v539: boolean, v540, v541: number):
// CHECK-NEXT: v542 = Increment v185
// CHECK-NEXT: v543 = Convert v542 declared={type=number}
// CHECK-NEXT: Jump -> next b36(v532, v533, v534, v535, v536, v537, v538, v539, v540, v541, v543)
// CHECK-NEXT: b141():
// CHECK-NEXT: v544 = Integer integer=2
// CHECK-NEXT: v545 = StrictEq v41, v544
// CHECK-NEXT: Branch v545 -> taken b145(v177), notTaken b142()
// CHECK-NEXT: b142():
// CHECK-NEXT: v546 = Integer integer=2
// CHECK-NEXT: v547 = StrictEq v37, v546
// CHECK-NEXT: Branch v547 -> taken b143(), notTaken b144()
// CHECK-NEXT: b143():
// CHECK-NEXT: Jump -> next b145(v176)
// CHECK-NEXT: b144():
// CHECK-NEXT: Jump -> next b145(v175)
// CHECK-NEXT: b145(v548):
// CHECK-NEXT: v549 = Integer integer=9
// CHECK-NEXT: v550 = StrictEq v29, v549
// CHECK-NEXT: Branch v550 -> taken b146(), notTaken b147()
// CHECK-NEXT: b146():
// CHECK-NEXT: v551 = Convert v161 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v552 = Convert v178 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v553 = TruncateNewArray v551, v552
// CHECK-NEXT: Return v553
// CHECK-NEXT: b147():
// CHECK-NEXT: v554 = TypeTest v161 testedType=undefined
// CHECK-NEXT: Branch v554 -> taken b148(| 0), notTaken b175(| 0)
// CHECK-NEXT: b148(v555):
// CHECK-NEXT: v556 = Integer integer=1
// CHECK-NEXT: v557 = StrictEq v29, v556
// CHECK-NEXT: Branch v557 -> taken b149(), notTaken b153()
// CHECK-NEXT: b149():
// CHECK-NEXT: v558 = ToBoolean v55
// CHECK-NEXT: Branch v558 -> taken b150(| 0), notTaken b151(| 0)
// CHECK-NEXT: b150(v559):
// CHECK-NEXT: Jump -> next b152(v548)
// CHECK-NEXT: b151(v560):
// CHECK-NEXT: Jump -> next b152(v106)
// CHECK-NEXT: b152(v561):
// CHECK-NEXT: Return v561
// CHECK-NEXT: b153():
// CHECK-NEXT: v562 = Integer integer=3
// CHECK-NEXT: v563 = StrictEq v29, v562
// CHECK-NEXT: Branch v563 -> taken b154(), notTaken b155()
// CHECK-NEXT: b154():
// CHECK-NEXT: v564 = GetModuleVariable variable=[[g_63]]
// CHECK-NEXT: v565 = Call v564, -, v180, v179 calleeName="finishReduce"
// CHECK-NEXT: ReturnCall v565
// CHECK-NEXT: b155():
// CHECK-NEXT: v566 = Integer integer=8
// CHECK-NEXT: v567 = StrictEq v29, v566
// CHECK-NEXT: Branch v567 -> taken b156(), notTaken b159()
// CHECK-NEXT: b156():
// CHECK-NEXT: v568 = GetModuleVariable variable=[[g_64]]
// CHECK-NEXT: v569 = ToBoolean v55
// CHECK-NEXT: Branch v569 -> taken b157(| 0), notTaken b158(v106)
// CHECK-NEXT: b157(v570):
// CHECK-NEXT: v571 = Integer integer=1
// CHECK-NEXT: v572 = Add v178, v571
// CHECK-NEXT: Jump -> next b158(v572)
// CHECK-NEXT: b158(v573):
// CHECK-NEXT: v574 = Call v568, -, v181, v129, v178, v573 calleeName="finishJoin"
// CHECK-NEXT: ReturnCall v574
// CHECK-NEXT: b159():
// CHECK-NEXT: v575 = ToBoolean v83
// CHECK-NEXT: Branch v575 -> taken b160(| 0), notTaken b167(| 0)
// CHECK-NEXT: b160(v576):
// CHECK-NEXT: v577 = Integer integer=4
// CHECK-NEXT: v578 = StrictEq v29, v577
// CHECK-NEXT: Branch v578 -> taken b166(v182), notTaken b161()
// CHECK-NEXT: b161():
// CHECK-NEXT: v579 = Integer integer=5
// CHECK-NEXT: v580 = StrictEq v29, v579
// CHECK-NEXT: Branch v580 -> taken b162(), notTaken b163()
// CHECK-NEXT: b162():
// CHECK-NEXT: v581 = ToBoolean v182
// CHECK-NEXT: v582 = LogicalNot v581
// CHECK-NEXT: Jump -> next b166(v582)
// CHECK-NEXT: b163():
// CHECK-NEXT: v583 = Integer integer=7
// CHECK-NEXT: v584 = StrictEq v29, v583
// CHECK-NEXT: Branch v584 -> taken b164(), notTaken b165()
// CHECK-NEXT: b164():
// CHECK-NEXT: Jump -> next b166(v184)
// CHECK-NEXT: b165():
// CHECK-NEXT: Jump -> next b166(v183)
// CHECK-NEXT: b166(v585):
// CHECK-NEXT: Return v585
// CHECK-NEXT: b167(v586):
// CHECK-NEXT: v587 = Integer integer=4
// CHECK-NEXT: v588 = StrictEq v29, v587
// CHECK-NEXT: Branch v588 -> taken b168(), notTaken b169()
// CHECK-NEXT: b168():
// CHECK-NEXT: v589 = Boolean
// CHECK-NEXT: Jump -> next b174(v589)
// CHECK-NEXT: b169():
// CHECK-NEXT: v590 = Integer integer=5
// CHECK-NEXT: v591 = StrictEq v29, v590
// CHECK-NEXT: Branch v591 -> taken b170(), notTaken b171()
// CHECK-NEXT: b170():
// CHECK-NEXT: v592 = Boolean boolean=true
// CHECK-NEXT: Jump -> next b174(v592)
// CHECK-NEXT: b171():
// CHECK-NEXT: v593 = Integer integer=7
// CHECK-NEXT: v594 = StrictEq v29, v593
// CHECK-NEXT: Branch v594 -> taken b172(), notTaken b173()
// CHECK-NEXT: b172():
// CHECK-NEXT: v595 = Integer integer=-1
// CHECK-NEXT: Jump -> next b174(v595)
// CHECK-NEXT: b173():
// CHECK-NEXT: v596 = Undefined
// CHECK-NEXT: Jump -> next b174(v596)
// CHECK-NEXT: b174(v597):
// CHECK-NEXT: Return v597
// CHECK-NEXT: b175(v598):
// CHECK-NEXT: v599 = NarrowByTest v161, v598
// CHECK-NEXT: v600 = ToBoolean v55
// CHECK-NEXT: Branch v600 -> taken b176(| 0), notTaken b177(v599)
// CHECK-NEXT: b176(v601):
// CHECK-NEXT: v602 = Convert v599 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v603 = Convert v548 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v604 = TruncateNewArray v602, v603
// CHECK-NEXT: Jump -> next b177(v604)
// CHECK-NEXT: b177(v605):
// CHECK-NEXT: Return v605
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decorateClass"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=2 enclosingRuntimeFunction=DecoratorsDecorateClass thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b3()
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Builtin builtin=Reflect
// CHECK-NEXT: v6 = PropGet v5 key="decorate"
// CHECK-NEXT: v7 = TypeTest v6 testedType=function
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b3()
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Builtin builtin=Reflect
// CHECK-NEXT: v10 = PropGet v9 key="decorate"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = Call v10, v9, v0, v1, v11, v12 calleeKey="decorate" calleeName="Reflect.decorate"
// CHECK-NEXT: ReturnCall v13
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = PropGet v0 key="length"
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Sub v14, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v1, v17)
// CHECK-NEXT: b4(v18, v19: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: v22 = GreaterEq v19, v21
// CHECK-NEXT: Branch v22 -> taken b5(), notTaken b10()
// CHECK-NEXT: b5():
// CHECK-NEXT: v23 = ElemGet v0, v19
// CHECK-NEXT: v24 = ToBoolean v23
// CHECK-NEXT: Branch v24 -> taken b6(| 0), notTaken b9(v18)
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: v26 = Call v23, -, v18 calleeName="decorator"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b7(| 0), notTaken b8(v18)
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: Jump -> next b8(v28)
// CHECK-NEXT: b8(v29):
// CHECK-NEXT: Jump -> next b9(v29)
// CHECK-NEXT: b9(v30):
// CHECK-NEXT: v31 = Decrement v19
// CHECK-NEXT: v32 = Convert v31 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v30, v32)
// CHECK-NEXT: b10():
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decorateMember"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything):
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b3()
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: v7 = Builtin builtin=Reflect
// CHECK-NEXT: v8 = PropGet v7 key="decorate"
// CHECK-NEXT: v9 = TypeTest v8 testedType=function
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3()
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = Builtin builtin=Reflect
// CHECK-NEXT: v12 = PropGet v11 key="decorate"
// CHECK-NEXT: v13 = Call v12, v11, v0, v1, v2, v3 calleeKey="decorate" calleeName="Reflect.decorate"
// CHECK-NEXT: Jump -> next b10(v13)
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = PropGet v0 key="length"
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Sub v14, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v3, v17)
// CHECK-NEXT: b4(v18, v19: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: v22 = GreaterEq v19, v21
// CHECK-NEXT: Branch v22 -> taken b5(), notTaken b10(v18)
// CHECK-NEXT: b5():
// CHECK-NEXT: v23 = ElemGet v0, v19
// CHECK-NEXT: v24 = ToBoolean v23
// CHECK-NEXT: Branch v24 -> taken b6(| 0), notTaken b9(v18)
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: v26 = Call v23, -, v1, v2, v18 calleeName="decorator"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b7(| 0), notTaken b8(v18)
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: Jump -> next b8(v28)
// CHECK-NEXT: b8(v29):
// CHECK-NEXT: Jump -> next b9(v29)
// CHECK-NEXT: b9(v30):
// CHECK-NEXT: v31 = Decrement v19
// CHECK-NEXT: v32 = Convert v31 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v30, v32)
// CHECK-NEXT: b10(v33):
// CHECK-NEXT: v34 = ToBoolean v33
// CHECK-NEXT: Branch v34 -> taken b11(| 0), notTaken b12()
// CHECK-NEXT: b11(v35):
// CHECK-NEXT: v36 = Builtin builtin=Object
// CHECK-NEXT: v37 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v38 = Call v37, v36, v1, v2, v33 calleeName="Object.defineProperty"
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decorateMethod"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=3 enclosingRuntimeFunction=DecoratorsDecorateMethod thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_66]]
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectGetOwnPropertyDescriptor
// CHECK-NEXT: v6 = Call v5, v4, v1, v2 calleeName="Object.getOwnPropertyDescriptor"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|number|string|symbol|bigint|[[L_67]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v3, -, v0, v1, v2, v7 calleeName="decorateMember"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decorateProperty"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=3 enclosingRuntimeFunction=DecoratorsDecorateProperty thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_66]]
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: v5 = Call v3, -, v0, v1, v2, v4 calleeName="decorateMember"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="decorateParameter"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=2 enclosingRuntimeFunction=DecoratorsDecorateParameter thisType={type=anything} parameters=[{type=number}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number, v1: anything):
// CHECK-NEXT: v2 = NewClosure v0, v1 function=[[f_68]]
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="defineMetadata"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=2 enclosingRuntimeFunction=DecoratorsDefineMetadata thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b3()
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Builtin builtin=Reflect
// CHECK-NEXT: v6 = PropGet v5 key="metadata"
// CHECK-NEXT: v7 = TypeTest v6 testedType=function
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b3()
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Builtin builtin=Reflect
// CHECK-NEXT: v10 = PropGet v9 key="metadata"
// CHECK-NEXT: v11 = Call v10, v9, v0, v1 calleeKey="metadata" calleeName="Reflect.metadata"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="metadataSymbol"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Symbol
// CHECK-NEXT: v1 = PropGet v0 key="metadata"
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: Return v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = Builtin builtin=Symbol
// CHECK-NEXT: v6 = Builtin builtin=SymbolFor
// CHECK-NEXT: v7 = String string="Symbol.metadata"
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeName="Symbol.for"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|symbol flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="throwTypeError"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=TypeError [isNotReadFromHolder]
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis [isNotReadFromHolder]
// CHECK-NEXT: v3 = Call v1, v2, v0
// CHECK-NEXT: Throw v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="defineNormalProperty"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = ElemHas v0, v1
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = Builtin builtin=Object
// CHECK-NEXT: v7 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v8 = Boolean boolean=true
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|boolean}
// CHECK-NEXT: v10 = Boolean boolean=true
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|boolean}
// CHECK-NEXT: v12 = Boolean boolean=true
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|boolean}
// CHECK-NEXT: v14 = NewObject -, v9, v11, v13, v2 layout=[[L_67]] fields=[1, 0, 5, 4]
// CHECK-NEXT: v15 = FinishObject v14
// CHECK-NEXT: v16 = Call v7, v6, v0, v1, v15 calleeName="Object.defineProperty"
// CHECK-NEXT: ReturnCall v16
// CHECK-NEXT: b2(v17):
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setFunctionName"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v4 = String string="name"
// CHECK-NEXT: v5 = Boolean
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|boolean}
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|boolean}
// CHECK-NEXT: v9 = NewObject -, v1, v6, v8 layout=[[L_67]] fields=[4, 1, 0]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: v11 = Call v3, v2, v0, v4, v10 calleeName="Object.defineProperty"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="expectFunction"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: v4 = NarrowByTest v0, v3
// CHECK-NEXT: v5 = TypeTest v4 testedType=function
// CHECK-NEXT: Branch v5 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Return v0
// CHECK-NEXT: b5(v7):
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_69]]
// CHECK-NEXT: v9 = String string="Function expected"
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="throwTypeError"
// CHECK-NEXT: ReturnCall v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createDecoratorMetadata"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=1 enclosingRuntimeFunction=DecoratorsCreateDecoratorMetadata thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v3 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v3 -> taken b2(), notTaken b1(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_70]]
// CHECK-NEXT: v6 = Call v5 calleeName="metadataSymbol"
// CHECK-NEXT: v7 = ElemGet v4, v6
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined|null
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Null
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Call v2, v1, v11 calleeName="Object.create"
// CHECK-NEXT: ReturnCall v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setDecoratorMetadata"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=2 enclosingRuntimeFunction=DecoratorsSetDecoratorMetadata thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_71]]
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_70]]
// CHECK-NEXT: v4 = Call v3 calleeName="metadataSymbol"
// CHECK-NEXT: v5 = Call v2, -, v0, v4, v1 calleeName="defineNormalProperty"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createElement"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=4 enclosingRuntimeFunction=DecoratorsCreateElement thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything):
// CHECK-NEXT: v4 = NewObject -, v0, v1, v2, v3 layout=[[L_72]] fields=[2, 3, 1, 0]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createPrivateStorage"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=3 enclosingRuntimeFunction=DecoratorsCreatePrivateStorage thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = NewObject -, v0, v1, v2 layout=[[L_73]] fields=[2, 0, 1]
// CHECK-NEXT: v4 = FinishObject v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createClassContext"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything):
// CHECK-NEXT: v4 = String string="class"
// CHECK-NEXT: v5 = NewClosure v1, v3 function=[[f_74]]
// CHECK-NEXT: v6 = NewObject -, v4, v0, v2, v5 layout=[[L_75]] fields=[1, 3, 2, 0]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createContext"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=5 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_76]]
// CHECK-NEXT: v6 = PropGet v0 key="name"
// CHECK-NEXT: v7 = Call v5, -, v6, v1, v2, v3 calleeName="createClassContext"
// CHECK-NEXT: v8 = PropGet v0 key="kind"
// CHECK-NEXT: PropSet v7, v8 key="kind"
// CHECK-NEXT: v10 = PropGet v0 key="isStatic"
// CHECK-NEXT: PropSet v7, v10 key="static"
// CHECK-NEXT: v12 = PropGet v0 key="isPrivate"
// CHECK-NEXT: PropSet v7, v12 key="private"
// CHECK-NEXT: PropSet v7, v4 key="access"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="requirePrivateState"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: undefined|null|string):
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Call v3, -, v1 calleeName="Object"
// CHECK-NEXT: v5 = StrictEq v4, v1
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: Branch v6 -> taken b1(| 0), notTaken b3()
// CHECK-NEXT: b1(v7):
// CHECK-NEXT: v8 = PropGet v0 key="call"
// CHECK-NEXT: v9 = Call v8, v0, v1 calleeKey="call" calleeName="test.call"
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3()
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_69]]
// CHECK-NEXT: v13 = String string="Cannot "
// CHECK-NEXT: v14 = Add v13, v2
// CHECK-NEXT: v15 = Call v12, -, v14 calleeName="throwTypeError"
// CHECK-NEXT: ReturnCall v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="testPrivateState"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Call v2, -, v1 calleeName="Object"
// CHECK-NEXT: v4 = StrictEq v3, v1
// CHECK-NEXT: Branch v4 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = PropGet v0 key="call"
// CHECK-NEXT: v6 = Call v5, v0, v1 calleeKey="call" calleeName="test.call"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_69]]
// CHECK-NEXT: v8 = String string="Cannot use the \"in\" operator on this value"
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="throwTypeError"
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createPublicAccess"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Data data=[[d_77]]
// CHECK-NEXT: v2 = NewClosure v0 function=[[f_78]]
// CHECK-NEXT: PropSet v1, v2 key="has"
// CHECK-NEXT: v4 = NewClosure v0 function=[[f_79]]
// CHECK-NEXT: PropSet v1, v4 key="get"
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_80]]
// CHECK-NEXT: PropSet v1, v6 key="set"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createPrivateAccess"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Data data=[[d_81]]
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_82]]
// CHECK-NEXT: PropSet v2, v3 key="has"
// CHECK-NEXT: v5 = NewClosure v0, v1 function=[[f_83]]
// CHECK-NEXT: PropSet v2, v5 key="get"
// CHECK-NEXT: v7 = NewClosure v0, v1 function=[[f_84]]
// CHECK-NEXT: PropSet v2, v7 key="set"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="takeAccessorResult"
// CHECK: module=[[m_65]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = NarrowByTest v0, v6
// CHECK-NEXT: v8 = TypeTest v7 testedType=function
// CHECK-NEXT: Branch v8 -> taken b5(), notTaken b3(| 0)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = TypeTest v9 testedType=null|object
// CHECK-NEXT: Branch v10 -> taken b4(| 0), notTaken b5()
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = TypeTest v7 testedType=null
// CHECK-NEXT: Branch v12 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_69]]
// CHECK-NEXT: v14 = String string="Object expected"
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="throwTypeError"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_85]]
// CHECK-NEXT: v18 = PropGet v7 key="get"
// CHECK-NEXT: v19 = Call v17, -, v18 calleeName="expectFunction"
// CHECK-NEXT: v20 = ToBoolean v19
// CHECK-NEXT: Branch v20 -> taken b7(| 0), notTaken b8()
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: PropSet v1, v18 key="get"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_85]]
// CHECK-NEXT: v24 = PropGet v7 key="set"
// CHECK-NEXT: v25 = Call v23, -, v24 calleeName="expectFunction"
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b9(| 0), notTaken b10()
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: PropSet v1, v24 key="set"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_85]]
// CHECK-NEXT: v30 = PropGet v7 key="init"
// CHECK-NEXT: v31 = Call v29, -, v30 calleeName="expectFunction"
// CHECK-NEXT: v32 = ToBoolean v31
// CHECK-NEXT: Branch v32 -> taken b11(| 0), notTaken b12()
// CHECK-NEXT: b11(v33):
// CHECK-NEXT: v34 = PropGet v2 key="unshift"
// CHECK-NEXT: v35 = Call v34, v2, v30 calleeKey="unshift" calleeName="valueInitializers.unshift"
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="applyClassDecorators"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=5 enclosingRuntimeFunction=DecoratorsApplyClassDecorators thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_86]]
// CHECK-NEXT: v6 = Call v5, -, v1, v2 calleeName="setFunctionName"
// CHECK-NEXT: v7 = PropGet v0 key="length"
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Sub v7, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v1, v10)
// CHECK-NEXT: b1(v11, v12: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = GreaterEq v12, v14
// CHECK-NEXT: Branch v15 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: v16 = Data data=[[d_87]]
// CHECK-NEXT: v17 = ElemGet v0, v12
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_76]]
// CHECK-NEXT: v19 = Call v18, -, v2, v16, v3, v4 calleeName="createClassContext"
// CHECK-NEXT: v20 = Call v17, -, v11, v19
// CHECK-NEXT: v21 = Integer integer=1
// CHECK-NEXT: PropSet v16, v21 key="_"
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_85]]
// CHECK-NEXT: v24 = Call v23, -, v20 calleeName="expectFunction"
// CHECK-NEXT: v25 = ToBoolean v24
// CHECK-NEXT: Branch v25 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v26):
// CHECK-NEXT: Jump -> next b5(v20)
// CHECK-NEXT: b4(v27):
// CHECK-NEXT: Jump -> next b5(v11)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: v29 = Decrement v12
// CHECK-NEXT: v30 = Convert v29 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v28, v30)
// CHECK-NEXT: b6():
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_88]]
// CHECK-NEXT: v32 = Call v31, -, v11, v3 calleeName="setDecoratorMetadata"
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="applyMethodDecorators"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=5 enclosingRuntimeFunction=DecoratorsApplyMethodDecorators thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything):
// CHECK-NEXT: v5 = PropGet v2 key="kind"
// CHECK-NEXT: v6 = PropGet v2 key="name"
// CHECK-NEXT: v7 = String string="method"
// CHECK-NEXT: v8 = StrictEq v5, v7
// CHECK-NEXT: Branch v8 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v9 = String string="value"
// CHECK-NEXT: Jump -> next b5(v9)
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = String string="getter"
// CHECK-NEXT: v11 = StrictEq v5, v10
// CHECK-NEXT: Branch v11 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = String string="get"
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = String string="set"
// CHECK-NEXT: Jump -> next b5(v13)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = Builtin builtin=Object
// CHECK-NEXT: v16 = Builtin builtin=ObjectGetOwnPropertyDescriptor
// CHECK-NEXT: v17 = Call v16, v15, v1, v6 calleeName="Object.getOwnPropertyDescriptor"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|number|string|symbol|bigint|[[L_67]] flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v0 key="length"
// CHECK-NEXT: v20 = Integer integer=1
// CHECK-NEXT: v21 = Sub v19, v20
// CHECK-NEXT: v22 = Convert v21 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v22)
// CHECK-NEXT: b6(v23: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v25 = Integer
// CHECK-NEXT: v26 = GreaterEq v23, v25
// CHECK-NEXT: Branch v26 -> taken b7(), notTaken b14()
// CHECK-NEXT: b7():
// CHECK-NEXT: v27 = Data data=[[d_89]]
// CHECK-NEXT: v28 = Data data=[[d_90]]
// CHECK-NEXT: v29 = NewClosure v6 function=[[f_91]]
// CHECK-NEXT: PropSet v28, v29 key="has"
// CHECK-NEXT: v31 = String string="setter"
// CHECK-NEXT: v32 = StrictEq v5, v31
// CHECK-NEXT: Branch v32 -> taken b8(), notTaken b9()
// CHECK-NEXT: b8():
// CHECK-NEXT: v33 = NewClosure v6 function=[[f_92]]
// CHECK-NEXT: PropSet v28, v33 key="set"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b9():
// CHECK-NEXT: v35 = NewClosure v6 function=[[f_93]]
// CHECK-NEXT: PropSet v28, v35 key="get"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v37 = ElemGet v0, v23
// CHECK-NEXT: v38 = ElemGet v18, v14
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_94]]
// CHECK-NEXT: v40 = Call v39, -, v2, v27, v3, v4, v28 calleeName="createContext"
// CHECK-NEXT: v41 = Call v37, -, v38, v40
// CHECK-NEXT: v42 = Integer integer=1
// CHECK-NEXT: PropSet v27, v42 key="_"
// CHECK-NEXT: v44 = GetModuleVariable variable=[[g_85]]
// CHECK-NEXT: v45 = Call v44, -, v41 calleeName="expectFunction"
// CHECK-NEXT: v46 = ToBoolean v45
// CHECK-NEXT: Branch v46 -> taken b11(| 0), notTaken b12(| 0)
// CHECK-NEXT: b11(v47):
// CHECK-NEXT: ElemSet v18, v14, v41
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b12(v49):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v50 = Decrement v23
// CHECK-NEXT: v51 = Convert v50 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v51)
// CHECK-NEXT: b14():
// CHECK-NEXT: v52 = Builtin builtin=Object
// CHECK-NEXT: v53 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v54 = Call v53, v52, v1, v6, v18 calleeName="Object.defineProperty"
// CHECK-NEXT: v55 = Undefined
// CHECK-NEXT: Return v55
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="applyPrivateMethodDecorators"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=6 enclosingRuntimeFunction=DecoratorsApplyPrivateMethodDecorators thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything, v5: anything):
// CHECK-NEXT: v6 = NewObject -, v1 layout=[[L_95]] fields=[0]
// CHECK-NEXT: v7 = PropGet v2 key="kind"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_86]]
// CHECK-NEXT: v9 = GetEnvironmentField v6 layout=[[L_95]]
// CHECK-NEXT: v10 = String string="setter"
// CHECK-NEXT: v11 = StrictEq v7, v10
// CHECK-NEXT: Branch v11 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v12 = String string="set "
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = String string="getter"
// CHECK-NEXT: v14 = StrictEq v7, v13
// CHECK-NEXT: Branch v14 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = String string="get "
// CHECK-NEXT: Jump -> next b5(v15)
// CHECK-NEXT: b4():
// CHECK-NEXT: v16 = String string=""
// CHECK-NEXT: Jump -> next b5(v16)
// CHECK-NEXT: b5(v17):
// CHECK-NEXT: v18 = PropGet v2 key="name"
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = Call v8, -, v9, v19 calleeName="setFunctionName"
// CHECK-NEXT: v21 = PropGet v0 key="length"
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = Sub v21, v22
// CHECK-NEXT: v24 = Convert v23 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v24)
// CHECK-NEXT: b6(v25: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v27 = Integer
// CHECK-NEXT: v28 = GreaterEq v25, v27
// CHECK-NEXT: Branch v28 -> taken b7(), notTaken b17()
// CHECK-NEXT: b7():
// CHECK-NEXT: v29 = Data data=[[d_96]]
// CHECK-NEXT: v30 = Data data=[[d_97]]
// CHECK-NEXT: v31 = NewClosure v3 function=[[f_98]]
// CHECK-NEXT: PropSet v30, v31 key="has"
// CHECK-NEXT: v33 = String string="method"
// CHECK-NEXT: v34 = StrictEq v7, v33
// CHECK-NEXT: Branch v34 -> taken b8(), notTaken b9()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = NewClosure v6, v3 function=[[f_99]]
// CHECK-NEXT: PropSet v30, v35 key="get"
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v37 = String string="getter"
// CHECK-NEXT: v38 = StrictEq v7, v37
// CHECK-NEXT: Branch v38 -> taken b10(), notTaken b11()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = NewClosure v6, v3 function=[[f_100]]
// CHECK-NEXT: PropSet v30, v39 key="get"
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v41 = String string="setter"
// CHECK-NEXT: v42 = StrictEq v7, v41
// CHECK-NEXT: Branch v42 -> taken b12(), notTaken b13()
// CHECK-NEXT: b12():
// CHECK-NEXT: v43 = NewClosure v6, v3 function=[[f_101]]
// CHECK-NEXT: PropSet v30, v43 key="set"
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v45 = ElemGet v0, v25
// CHECK-NEXT: v46 = GetEnvironmentField v6 layout=[[L_95]]
// CHECK-NEXT: v47 = GetModuleVariable variable=[[g_94]]
// CHECK-NEXT: v48 = Call v47, -, v2, v29, v4, v5, v30 calleeName="createContext"
// CHECK-NEXT: v49 = Call v45, -, v46, v48
// CHECK-NEXT: v50 = Integer integer=1
// CHECK-NEXT: PropSet v29, v50 key="_"
// CHECK-NEXT: v52 = GetModuleVariable variable=[[g_85]]
// CHECK-NEXT: v53 = Call v52, -, v49 calleeName="expectFunction"
// CHECK-NEXT: v54 = ToBoolean v53
// CHECK-NEXT: Branch v54 -> taken b14(| 0), notTaken b15(| 0)
// CHECK-NEXT: b14(v55):
// CHECK-NEXT: PutEnvironmentField v6, v49 layout=[[L_95]]
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b15(v57):
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16():
// CHECK-NEXT: v58 = Decrement v25
// CHECK-NEXT: v59 = Convert v58 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v59)
// CHECK-NEXT: b17():
// CHECK-NEXT: v60 = GetEnvironmentField v6 layout=[[L_95]]
// CHECK-NEXT: Return v60
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="applyFieldDecorators"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=5 enclosingRuntimeFunction=DecoratorsApplyFieldDecorators thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything):
// CHECK-NEXT: v5 = PropGet v1 key="name"
// CHECK-NEXT: v6 = PropGet v0 key="length"
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Sub v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v9)
// CHECK-NEXT: b1(v10: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = GreaterEq v10, v12
// CHECK-NEXT: Branch v13 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: v14 = Data data=[[d_102]]
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_103]]
// CHECK-NEXT: v16 = Call v15, -, v5 calleeName="createPublicAccess"
// CHECK-NEXT: v17 = ElemGet v0, v10
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_94]]
// CHECK-NEXT: v20 = Call v19, -, v1, v14, v2, v4, v16 calleeName="createContext"
// CHECK-NEXT: v21 = Call v17, -, v18, v20
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: PropSet v14, v22 key="_"
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_85]]
// CHECK-NEXT: v25 = Call v24, -, v21 calleeName="expectFunction"
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v3 key="unshift"
// CHECK-NEXT: v29 = Call v28, v3, v21 calleeKey="unshift" calleeName="valueInitializers.unshift"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v31 = Decrement v10
// CHECK-NEXT: v32 = Convert v31 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v32)
// CHECK-NEXT: b6():
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="applyPrivateFieldDecorators"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=6 enclosingRuntimeFunction=DecoratorsApplyPrivateFieldDecorators thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything, v5: anything):
// CHECK-NEXT: v6 = PropGet v0 key="length"
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Sub v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v9)
// CHECK-NEXT: b1(v10: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = GreaterEq v10, v12
// CHECK-NEXT: Branch v13 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: v14 = Data data=[[d_104]]
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_105]]
// CHECK-NEXT: v16 = PropGet v2 key="test"
// CHECK-NEXT: v17 = Call v15, -, v16, v2 calleeName="createPrivateAccess"
// CHECK-NEXT: v18 = ElemGet v0, v10
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_94]]
// CHECK-NEXT: v21 = Call v20, -, v1, v14, v3, v5, v17 calleeName="createContext"
// CHECK-NEXT: v22 = Call v18, -, v19, v21
// CHECK-NEXT: v23 = Integer integer=1
// CHECK-NEXT: PropSet v14, v23 key="_"
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_85]]
// CHECK-NEXT: v26 = Call v25, -, v22 calleeName="expectFunction"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v28):
// CHECK-NEXT: v29 = PropGet v4 key="unshift"
// CHECK-NEXT: v30 = Call v29, v4, v22 calleeKey="unshift" calleeName="valueInitializers.unshift"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v31):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v32 = Decrement v10
// CHECK-NEXT: v33 = Convert v32 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v33)
// CHECK-NEXT: b6():
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="applyAccessorDecorators"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=6 enclosingRuntimeFunction=DecoratorsApplyAccessorDecorators thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything, v5: anything):
// CHECK-NEXT: v6 = PropGet v2 key="name"
// CHECK-NEXT: v7 = Builtin builtin=Object
// CHECK-NEXT: v8 = Builtin builtin=ObjectGetOwnPropertyDescriptor
// CHECK-NEXT: v9 = Call v8, v7, v1, v6 calleeName="Object.getOwnPropertyDescriptor"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|number|string|symbol|bigint|[[L_67]] flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="get"
// CHECK-NEXT: v12 = PropGet v10 key="set"
// CHECK-NEXT: v13 = Boolean boolean=true
// CHECK-NEXT: v14 = Boolean boolean=true
// CHECK-NEXT: v15 = NewObject -, v11, v12, v13, v14 layout=[[L_106]] fields=[2, 3, 1, 0]
// CHECK-NEXT: v16 = FinishObject v15
// CHECK-NEXT: v17 = PropGet v0 key="length"
// CHECK-NEXT: v18 = Integer integer=1
// CHECK-NEXT: v19 = Sub v17, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v20)
// CHECK-NEXT: b1(v21: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v23 = Integer
// CHECK-NEXT: v24 = GreaterEq v21, v23
// CHECK-NEXT: Branch v24 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v25 = Data data=[[d_107]]
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_94]]
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_103]]
// CHECK-NEXT: v28 = Call v27, -, v6 calleeName="createPublicAccess"
// CHECK-NEXT: v29 = Call v26, -, v2, v25, v3, v5, v28 calleeName="createContext"
// CHECK-NEXT: v30 = ElemGet v0, v21
// CHECK-NEXT: v31 = PropGet v16 key="get"
// CHECK-NEXT: v32 = PropGet v16 key="set"
// CHECK-NEXT: v33 = NewObject -, v31, v32 layout=[[L_108]] fields=[0, 1]
// CHECK-NEXT: v34 = FinishObject v33
// CHECK-NEXT: v35 = Call v30, -, v34, v29
// CHECK-NEXT: v36 = Integer integer=1
// CHECK-NEXT: PropSet v25, v36 key="_"
// CHECK-NEXT: v38 = GetModuleVariable variable=[[g_109]]
// CHECK-NEXT: v39 = Call v38, -, v35, v16, v4 calleeName="takeAccessorResult"
// CHECK-NEXT: v40 = Decrement v21
// CHECK-NEXT: v41 = Convert v40 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v41)
// CHECK-NEXT: b3():
// CHECK-NEXT: v42 = Builtin builtin=Object
// CHECK-NEXT: v43 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v44 = Call v43, v42, v1, v6, v16 calleeName="Object.defineProperty"
// CHECK-NEXT: v45 = Undefined
// CHECK-NEXT: Return v45
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="applyPrivateAccessorDecorators"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=6 enclosingRuntimeFunction=DecoratorsApplyPrivateAccessorDecorators thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything, v5: anything):
// CHECK-NEXT: v6 = PropGet v2 key="get"
// CHECK-NEXT: v7 = PropGet v2 key="set"
// CHECK-NEXT: v8 = NewObject -, v6, v7 layout=[[L_108]] fields=[0, 1]
// CHECK-NEXT: v9 = FinishObject v8
// CHECK-NEXT: v10 = PropGet v0 key="length"
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = Sub v10, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v13)
// CHECK-NEXT: b1(v14: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = GreaterEq v14, v16
// CHECK-NEXT: Branch v17 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = Data data=[[d_110]]
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_94]]
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_105]]
// CHECK-NEXT: v21 = PropGet v2 key="test"
// CHECK-NEXT: v22 = Call v20, -, v21, v9 calleeName="createPrivateAccess"
// CHECK-NEXT: v23 = Call v19, -, v1, v18, v3, v5, v22 calleeName="createContext"
// CHECK-NEXT: v24 = ElemGet v0, v14
// CHECK-NEXT: v25 = PropGet v9 key="get"
// CHECK-NEXT: v26 = PropGet v9 key="set"
// CHECK-NEXT: v27 = NewObject -, v25, v26 layout=[[L_108]] fields=[0, 1]
// CHECK-NEXT: v28 = FinishObject v27
// CHECK-NEXT: v29 = Call v24, -, v28, v23
// CHECK-NEXT: v30 = Integer integer=1
// CHECK-NEXT: PropSet v18, v30 key="_"
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_109]]
// CHECK-NEXT: v33 = Call v32, -, v29, v9, v4 calleeName="takeAccessorResult"
// CHECK-NEXT: v34 = Decrement v14
// CHECK-NEXT: v35 = Convert v34 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v35)
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="runInitializers"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=2 enclosingRuntimeFunction=DecoratorsRunInitializers thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = PropGet v0 key="length"
// CHECK-NEXT: Jump -> next b1(v3)
// CHECK-NEXT: b1(v5: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = Less v5, v4
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = ElemGet v0, v5
// CHECK-NEXT: v9 = PropGet v8 key="call"
// CHECK-NEXT: v10 = Call v9, v8, v1 calleeKey="call" calleeName="initializers[i].call"
// CHECK-NEXT: v11 = Increment v5
// CHECK-NEXT: v12 = Convert v11 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v12)
// CHECK-NEXT: b3():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="runValueInitializers"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=3 enclosingRuntimeFunction=DecoratorsRunValueInitializers thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: v5 = PropGet v0 key="length"
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v6, v7: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = Less v7, v5
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = ElemGet v0, v7
// CHECK-NEXT: v11 = PropGet v10 key="call"
// CHECK-NEXT: v12 = Call v11, v10, v1, v6 calleeKey="call" calleeName="initializers[i].call"
// CHECK-NEXT: v13 = Increment v7
// CHECK-NEXT: v14 = Convert v13 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v12, v14)
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked] length=2 enclosingRuntimeFunction=DecoratorsDecorateParameter captures=[{type=number variableName="index"}, {type=anything variableName="decorator"}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number, v1: anything, v2: anything, v3: anything):
// CHECK-NEXT: v4 = Call v1, -, v2, v3, v0 calleeName="decorator"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="addInitializer"
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked, IsHiddenInStackTraces] length=1 captures=[{type=anything variableName="done"}, {type=anything variableName="initializers"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = PropGet v0 key="_"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_69]]
// CHECK-NEXT: v7 = String string="Already initialized"
// CHECK-NEXT: v8 = Call v6, -, v7 calleeName="throwTypeError"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = PropGet v1 key="push"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_85]]
// CHECK-NEXT: v12 = ToBoolean v2
// CHECK-NEXT: Branch v12 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: Jump -> next b5(v13)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = Null
// CHECK-NEXT: Jump -> next b5(v15)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: v17 = Call v11, -, v16 calleeName="expectFunction"
// CHECK-NEXT: v18 = Call v10, v1, v17 calleeKey="push" calleeName="initializers.push"
// CHECK-NEXT: ReturnCall v18
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked, IsHiddenInStackTraces] length=1 captures=[{type=anything variableName="name"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = ElemHas v1, v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked, IsHiddenInStackTraces] length=1 captures=[{type=anything variableName="name"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = ElemGet v1, v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked, IsHiddenInStackTraces] length=2 captures=[{type=anything variableName="name"}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: ElemSet v1, v0, v2
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked, IsHiddenInStackTraces] length=1 captures=[{type=anything variableName="test"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_111]]
// CHECK-NEXT: v3 = Call v2, -, v0, v1 calleeName="testPrivateState"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked, IsHiddenInStackTraces] length=1 captures=[{type=anything variableName="test"}, {type=anything variableName="accessors"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_112]]
// CHECK-NEXT: v4 = String string="read from private field"
// CHECK-NEXT: v5 = Call v3, -, v0, v2, v4 calleeName="requirePrivateState"
// CHECK-NEXT: v6 = PropGet v1 key="get"
// CHECK-NEXT: v7 = PropGet v6 key="call"
// CHECK-NEXT: v8 = Call v7, v6, v2 calleeKey="call" calleeName="accessors.get.call"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked, IsHiddenInStackTraces] length=2 captures=[{type=anything variableName="test"}, {type=anything variableName="accessors"}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything):
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_112]]
// CHECK-NEXT: v5 = String string="write to private field"
// CHECK-NEXT: v6 = Call v4, -, v0, v2, v5 calleeName="requirePrivateState"
// CHECK-NEXT: v7 = PropGet v1 key="set"
// CHECK-NEXT: v8 = PropGet v7 key="call"
// CHECK-NEXT: v9 = Call v8, v7, v2, v3 calleeKey="call" calleeName="accessors.set.call"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked] length=1 enclosingRuntimeFunction=DecoratorsApplyMethodDecorators captures=[{type=anything variableName="name"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = ElemHas v1, v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked] length=2 enclosingRuntimeFunction=DecoratorsApplyMethodDecorators captures=[{type=anything variableName="name"}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: ElemSet v1, v0, v2
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked] length=1 enclosingRuntimeFunction=DecoratorsApplyMethodDecorators captures=[{type=anything variableName="name"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = ElemGet v1, v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked] length=1 enclosingRuntimeFunction=DecoratorsApplyPrivateMethodDecorators captures=[{type=anything variableName="test"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_111]]
// CHECK-NEXT: v3 = Call v2, -, v0, v1 calleeName="testPrivateState"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked] length=1 enclosingRuntimeFunction=DecoratorsApplyPrivateMethodDecorators captures=[{type=env [[L_95]] flags=[IsFromCompiler]}, {type=anything variableName="test"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_95]], v1: anything, v2: anything):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_112]]
// CHECK-NEXT: v4 = String string="access private method"
// CHECK-NEXT: v5 = Call v3, -, v1, v2, v4 calleeName="requirePrivateState"
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_95]]
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked] length=1 enclosingRuntimeFunction=DecoratorsApplyPrivateMethodDecorators captures=[{type=env [[L_95]] flags=[IsFromCompiler]}, {type=anything variableName="test"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_95]], v1: anything, v2: anything):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_112]]
// CHECK-NEXT: v4 = String string="read from private field"
// CHECK-NEXT: v5 = Call v3, -, v1, v2, v4 calleeName="requirePrivateState"
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_95]]
// CHECK-NEXT: v7 = PropGet v6 key="call"
// CHECK-NEXT: v8 = Call v7, v6, v2 calleeKey="call" calleeName="value.call"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] position={{*}} text={{*}} kind=Arrow role=Library flags=[IsChecked] length=2 enclosingRuntimeFunction=DecoratorsApplyPrivateMethodDecorators captures=[{type=env [[L_95]] flags=[IsFromCompiler]}, {type=anything variableName="test"}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_95]], v1: anything, v2: anything, v3: anything):
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_112]]
// CHECK-NEXT: v5 = String string="write to private field"
// CHECK-NEXT: v6 = Call v4, -, v1, v2, v5 calleeName="requirePrivateState"
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_95]]
// CHECK-NEXT: v8 = PropGet v7 key="call"
// CHECK-NEXT: v9 = Call v8, v7, v2, v3 calleeKey="call" calleeName="value.call"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_65]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_65]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK-LABEL: function {{*}}name="toArray"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[HasThis, IsChecked, IsHiddenInStackTraces, HasExplicitName] enclosingRuntimeFunction=IteratorConsumersToArray thisType={type=anything} results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=object
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b7(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = PropGet v0 key="next"
// CHECK-NEXT: v4 = Data data=[[d_114]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = TypeTest v3 testedType=function
// CHECK-NEXT: Branch v7 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: v9 = NarrowByTest v3, v8
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_115]]
// CHECK-NEXT: v11 = Call v10, -, v0, v9 calleeName="stepIterator"
// CHECK-NEXT: v12 = IsCollectionIteratorClosedMark v11
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Return v5
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: v16 = Convert v5 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v17 = PropGet v16 key="length"
// CHECK-NEXT: ElemDefine v16, v17, v11
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = ThrowNewError errorKind=TypeError message="Type error"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: v22 = ThrowNewError errorKind=TypeError message="Iterator.prototype.toArray requires that |this| be an Object."
// CHECK-NEXT: Unreachable
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="forEach"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[HasThis, IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 enclosingRuntimeFunction=IteratorConsumersForEach thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = TypeTest v0 testedType=object
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b23(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b16(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = NarrowByTest v1, v5
// CHECK-NEXT: v7 = PropGet v0 key="next"
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v9)
// CHECK-NEXT: b3(v10: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = TypeTest v7 testedType=function
// CHECK-NEXT: Branch v12 -> taken b4(| 0), notTaken b15(| 0)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = NarrowByTest v7, v13
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_115]]
// CHECK-NEXT: v16 = Call v15, -, v0, v14 calleeName="stepIterator"
// CHECK-NEXT: v17 = IsCollectionIteratorClosedMark v16
// CHECK-NEXT: v18 = ToBoolean v17
// CHECK-NEXT: Branch v18 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b9():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: v23 = ToNumeric v10
// CHECK-NEXT: v24 = Increment v23
// CHECK-NEXT: v25 = Convert v24 declared={type=number}
// CHECK-NEXT: v26 = Call v6, v22, v16, v23
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Jump -> next b3(v25)
// CHECK-NEXT: b9() role=CleanupHandler:
// CHECK-NEXT: v28 = CatchException
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b13():
// CHECK-NEXT: v29 = PropGet v0 key="return"
// CHECK-NEXT: v30 = TypeTest v29 testedType=undefined|null
// CHECK-NEXT: Branch v30 -> taken b11(| 0), notTaken b12(| 0)
// CHECK-NEXT: b11(v31) handler=b13():
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b12(v32) handler=b13():
// CHECK-NEXT: v33 = Call v32, v0
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b13() role=CatchHandler:
// CHECK-NEXT: v34 = CatchValue
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: Rethrow v28
// CHECK-NEXT: b15(v35):
// CHECK-NEXT: v36 = ThrowNewError errorKind=TypeError message="Type error"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b16(v37):
// CHECK-NEXT: Jump -> next b17()
// CHECK-NEXT: b17() handler=b21():
// CHECK-NEXT: v38 = PropGet v0 key="return"
// CHECK-NEXT: v39 = TypeTest v38 testedType=undefined|null
// CHECK-NEXT: Branch v39 -> taken b18(| 0), notTaken b19(| 0)
// CHECK-NEXT: b18(v40) handler=b21():
// CHECK-NEXT: Jump -> next b20()
// CHECK-NEXT: b19(v41) handler=b21():
// CHECK-NEXT: v42 = Call v41, v0
// CHECK-NEXT: v43 = RequireObject v42 runtimeError=IteratorResultNotObject
// CHECK-NEXT: Jump -> next b20()
// CHECK-NEXT: b20() handler=b21():
// CHECK-NEXT: v44 = Undefined
// CHECK-NEXT: Jump -> next b22()
// CHECK-NEXT: b21() role=CatchHandler:
// CHECK-NEXT: v45 = CatchValue
// CHECK-NEXT: Jump -> next b22()
// CHECK-NEXT: b22():
// CHECK-NEXT: v46 = ThrowNewError errorKind=TypeError message="Iterator.prototype.forEach requires the callback argument to be callable."
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b23(v47):
// CHECK-NEXT: v48 = ThrowNewError errorKind=TypeError message="Iterator.prototype.forEach requires that |this| be an Object."
// CHECK-NEXT: Unreachable
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="from"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[HasThis, IsChecked, HasExplicitName] length=3 enclosingRuntimeFunction=IteratorConsumersFrom thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected, OmitsNull, OmitsUndefined]}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|Array, v2: anything, v3: anything):
// CHECK-NEXT: v4 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v5 = StrictEq v0, v4
// CHECK-NEXT: Branch v5 -> taken b3(), notTaken b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = IsConstructor v0
// CHECK-NEXT: v7 = ToBoolean v6
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b3()
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Construct v0 calleeName="this"
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Data data=[[d_116]]
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b5(| 0), notTaken b14(| 0)
// CHECK-NEXT: b5(v13):
// CHECK-NEXT: v14 = NarrowByTest v11, v13
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = Convert v15 declared={type=number}
// CHECK-NEXT: v17 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b6(v18: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v20 = IteratorResume v17
// CHECK-NEXT: v21 = ResultAt v20
// CHECK-NEXT: v22 = ResultAt v20 index=1
// CHECK-NEXT: Branch v21 -> taken b7(), notTaken b8()
// CHECK-NEXT: b7():
// CHECK-NEXT: PropSet v14, v18 key="length"
// CHECK-NEXT: Return v14
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b13():
// CHECK-NEXT: v24 = TypeTest v3 testedType=undefined
// CHECK-NEXT: Branch v24 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v25) handler=b13():
// CHECK-NEXT: v26 = Call v2, -, v22, v18 calleeName="mapper"
// CHECK-NEXT: Jump -> next b12(v26)
// CHECK-NEXT: b11(v27) handler=b13():
// CHECK-NEXT: v28 = NarrowByTest v3, v27
// CHECK-NEXT: v29 = Call v2, v28, v22, v18
// CHECK-NEXT: Jump -> next b12(v29)
// CHECK-NEXT: b12(v30) handler=b13():
// CHECK-NEXT: v31 = Convert v14 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: ElemDefine v31, v18, v30
// CHECK-NEXT: v33 = Integer integer=1
// CHECK-NEXT: v34 = Add v18, v33
// CHECK-NEXT: v35 = Convert v34 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v35)
// CHECK-NEXT: b13() role=IterationCleanup subject=v17:
// CHECK-NEXT: v36 = CatchException
// CHECK-NEXT: IteratorClose v17 completion=Throw
// CHECK-NEXT: Rethrow v36
// CHECK-NEXT: b14(v38):
// CHECK-NEXT: v39 = ThrowNewError errorKind=TypeError message="Array.from requires that |this| constructs an object"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fromIterable"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[HasThis, IsChecked, HasExplicitName] length=1 enclosingRuntimeFunction=IteratorConsumersFromIterable thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|Array):
// CHECK-NEXT: v2 = TypeTest v1 testedType=string
// CHECK-NEXT: Branch v2 -> taken b3(), notTaken b1(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NarrowByTest v1, v3
// CHECK-NEXT: v5 = Builtin builtin=LinkTimeConstantArrayFromFastWithoutMapFn [isNotReadFromHolder]
// CHECK-NEXT: v6 = Call v5, -, v0, v4
// CHECK-NEXT: v7 = ToBoolean v6
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b3()
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Convert v6 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Data data=[[d_117]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = IteratorResume v12
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Branch v15 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b8():
// CHECK-NEXT: v17 = Convert v11 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v18 = PropGet v17 key="length"
// CHECK-NEXT: ElemDefine v17, v18, v16
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b8() role=IterationCleanup subject=v12:
// CHECK-NEXT: v20 = CatchException
// CHECK-NEXT: IteratorClose v12 completion=Throw
// CHECK-NEXT: Rethrow v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="appendIterable"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 enclosingRuntimeFunction=IteratorConsumersAppendIterable thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything):
// CHECK-NEXT: v2 = PropGet v1 key=@@iterator
// CHECK-NEXT: v3 = TypeTest v2 testedType=function
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b17(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = NarrowByTest v2, v4
// CHECK-NEXT: v6 = Call v5, v1
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = ThrowNewError errorKind=TypeError message="undefined is not an object"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: v11 = NarrowByTest v6, v10
// CHECK-NEXT: v12 = TypeTest v11 testedType=null
// CHECK-NEXT: Branch v12 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = ThrowNewError errorKind=TypeError message="null is not an object"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: v16 = NarrowByTest v6, v15
// CHECK-NEXT: v17 = PropGet v16 key="next"
// CHECK-NEXT: v18 = Builtin builtin=GeneratorPrototypeNext [isNotReadFromHolder]
// CHECK-NEXT: v19 = StrictEq v17, v18
// CHECK-NEXT: Branch v19 -> taken b6(), notTaken b11()
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: v22 = StepGenerator v16, v21 check=IsGenerator
// CHECK-NEXT: v23 = ResultAt v22
// CHECK-NEXT: v24 = ResultAt v22 index=1
// CHECK-NEXT: v25 = Integer integer=2
// CHECK-NEXT: v26 = StrictEq v24, v25
// CHECK-NEXT: Branch v26 -> taken b11(), notTaken b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v27 = Integer integer=1
// CHECK-NEXT: v28 = StrictEq v24, v27
// CHECK-NEXT: Branch v28 -> taken b9(), notTaken b10()
// CHECK-NEXT: b9():
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: b10():
// CHECK-NEXT: v30 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v31 = PropGet v30 key="length"
// CHECK-NEXT: ElemDefine v30, v31, v23
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b11():
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v34 = Call v17, v16
// CHECK-NEXT: v35 = TypeTest v34 testedType=object
// CHECK-NEXT: Branch v35 -> taken b13(| 0), notTaken b16(| 0)
// CHECK-NEXT: b13(v36):
// CHECK-NEXT: v37 = NarrowByTest v34, v36
// CHECK-NEXT: v38 = PropGet v37 key="done"
// CHECK-NEXT: v39 = ToBoolean v38
// CHECK-NEXT: Branch v39 -> taken b14(| 0), notTaken b15(| 0)
// CHECK-NEXT: b14(v40):
// CHECK-NEXT: v41 = Undefined
// CHECK-NEXT: Return v41
// CHECK-NEXT: b15(v42):
// CHECK-NEXT: v43 = PropGet v37 key="value"
// CHECK-NEXT: v44 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v45 = PropGet v44 key="length"
// CHECK-NEXT: ElemDefine v44, v45, v43
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b16(v47):
// CHECK-NEXT: v48 = ThrowNewError errorKind=TypeError message="Iterator result interface is not an object"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b17(v49):
// CHECK-NEXT: v50 = ThrowNewError errorKind=TypeError message="Spread syntax requires ...iterable[Symbol.iterator] to be a function"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="takeFromIterable"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 enclosingRuntimeFunction=IteratorConsumersTakeFromIterable thisType={type=anything} parameters=[{type=anything}, {type=number}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_118]]
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="openIterator"
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = CollectionIteratorClosedMark
// CHECK-NEXT: v7 = NewArray v6 contents=anything
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = NarrowByTest v3, v9
// CHECK-NEXT: v11 = PropGet v10 key="next"
// CHECK-NEXT: v12 = TypeTest v11 testedType=function
// CHECK-NEXT: Branch v12 -> taken b3(| 0), notTaken b16(| 0)
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: v14 = NarrowByTest v11, v13
// CHECK-NEXT: v15 = Data data=[[d_119]]
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = Integer
// CHECK-NEXT: v18 = Convert v17 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v18)
// CHECK-NEXT: b4(v19: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v21 = Less v19, v1
// CHECK-NEXT: Branch v21 -> taken b5(), notTaken b8()
// CHECK-NEXT: b5():
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_115]]
// CHECK-NEXT: v23 = Call v22, -, v10, v14 calleeName="stepIterator"
// CHECK-NEXT: v24 = IsCollectionIteratorClosedMark v23
// CHECK-NEXT: v25 = ToBoolean v24
// CHECK-NEXT: Branch v25 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v26):
// CHECK-NEXT: Return v16
// CHECK-NEXT: b7(v27):
// CHECK-NEXT: v28 = Convert v16 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v29 = PropGet v28 key="length"
// CHECK-NEXT: ElemDefine v28, v29, v23
// CHECK-NEXT: v31 = Increment v19
// CHECK-NEXT: v32 = Convert v31 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v32)
// CHECK-NEXT: b8():
// CHECK-NEXT: v33 = PropGet v10 key="return"
// CHECK-NEXT: v34 = TypeTest v33 testedType=undefined
// CHECK-NEXT: Branch v34 -> taken b10(), notTaken b9(| 0)
// CHECK-NEXT: b9(v35):
// CHECK-NEXT: v36 = NarrowByTest v33, v35
// CHECK-NEXT: v37 = TypeTest v36 testedType=null
// CHECK-NEXT: Branch v37 -> taken b10(), notTaken b11(| 0)
// CHECK-NEXT: b10():
// CHECK-NEXT: Return v16
// CHECK-NEXT: b11(v38):
// CHECK-NEXT: v39 = NarrowByTest v33, v38
// CHECK-NEXT: v40 = TypeTest v39 testedType=function
// CHECK-NEXT: Branch v40 -> taken b12(| 0), notTaken b15(| 0)
// CHECK-NEXT: b12(v41):
// CHECK-NEXT: v42 = NarrowByTest v33, v41
// CHECK-NEXT: v43 = Call v42, v10
// CHECK-NEXT: v44 = TypeTest v43 testedType=object
// CHECK-NEXT: Branch v44 -> taken b13(| 0), notTaken b14(| 0)
// CHECK-NEXT: b13(v45):
// CHECK-NEXT: Return v16
// CHECK-NEXT: b14(v46):
// CHECK-NEXT: v47 = ThrowNewError errorKind=TypeError message="Iterator result interface is not an object."
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b15(v48):
// CHECK-NEXT: v49 = NarrowByTest v33, v48
// CHECK-NEXT: v50 = CollectionIteratorClosedMark
// CHECK-NEXT: v51 = NewArray v50, v49 contents=anything
// CHECK-NEXT: v52 = Convert v51 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v52
// CHECK-NEXT: b16(v53):
// CHECK-NEXT: v54 = NarrowByTest v11, v53
// CHECK-NEXT: v55 = CollectionIteratorClosedMark
// CHECK-NEXT: v56 = NewArray v55, v54 contents=anything
// CHECK-NEXT: v57 = Convert v56 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v57
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="appendGenerator"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 enclosingRuntimeFunction=IteratorConsumersAppendGenerator thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Generator flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: undefined|null|Generator):
// CHECK-NEXT: v2 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = IteratorResume v2
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v8 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: ElemDefine v8, v9, v6
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v2:
// CHECK-NEXT: v11 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="stepOverText"
// CHECK: module=[[m_113]] position={{*}} text={{*}} role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_120]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_120]]):
// CHECK-NEXT: v1 = PropGet v0 key="text"
// CHECK-NEXT: v2 = PropGet v0 key="position"
// CHECK-NEXT: v3 = TypeTest v1 testedType=string
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b11()
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = NarrowByTest v1, v4
// CHECK-NEXT: v6 = TypeTest v2 testedType=number
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b11()
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = NarrowByTest v2, v7
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = BitOr v8, v9
// CHECK-NEXT: v11 = PropGet v5 key="length"
// CHECK-NEXT: v12 = GreaterEq v10, v11
// CHECK-NEXT: Branch v12 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v13 = CollectionIteratorClosedMark
// CHECK-NEXT: Return v13
// CHECK-NEXT: b4():
// CHECK-NEXT: v14 = PropGet v5 key="charCodeAt"
// CHECK-NEXT: v15 = Call v14, v5, v10 calleeKey="charCodeAt" calleeName="text.charCodeAt"
// CHECK-NEXT: v16 = Convert v15 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = Integer integer=55296
// CHECK-NEXT: v18 = GreaterEq v16, v17
// CHECK-NEXT: Branch v18 -> taken b5(), notTaken b10()
// CHECK-NEXT: b5():
// CHECK-NEXT: v19 = Integer integer=56319
// CHECK-NEXT: v20 = LessEq v16, v19
// CHECK-NEXT: Branch v20 -> taken b6(), notTaken b10()
// CHECK-NEXT: b6():
// CHECK-NEXT: v21 = Integer integer=1
// CHECK-NEXT: v22 = Add v10, v21
// CHECK-NEXT: v23 = Less v22, v11
// CHECK-NEXT: Branch v23 -> taken b7(), notTaken b10()
// CHECK-NEXT: b7():
// CHECK-NEXT: v24 = PropGet v5 key="charCodeAt"
// CHECK-NEXT: v25 = Integer integer=1
// CHECK-NEXT: v26 = Add v10, v25
// CHECK-NEXT: v27 = Call v24, v5, v26 calleeKey="charCodeAt" calleeName="text.charCodeAt"
// CHECK-NEXT: v28 = Convert v27 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v29 = Integer integer=56320
// CHECK-NEXT: v30 = GreaterEq v28, v29
// CHECK-NEXT: Branch v30 -> taken b8(), notTaken b10()
// CHECK-NEXT: b8():
// CHECK-NEXT: v31 = Integer integer=57343
// CHECK-NEXT: v32 = LessEq v28, v31
// CHECK-NEXT: Branch v32 -> taken b9(), notTaken b10()
// CHECK-NEXT: b9():
// CHECK-NEXT: v33 = Integer integer=2
// CHECK-NEXT: v34 = Add v10, v33
// CHECK-NEXT: PropSet v0, v34 key="position"
// CHECK-NEXT: v36 = PropGet v5 key="substring"
// CHECK-NEXT: v37 = Integer integer=2
// CHECK-NEXT: v38 = Add v10, v37
// CHECK-NEXT: v39 = Call v36, v5, v10, v38 calleeKey="substring" calleeName="text.substring"
// CHECK-NEXT: ReturnCall v39 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b10():
// CHECK-NEXT: v40 = Integer integer=1
// CHECK-NEXT: v41 = Add v10, v40
// CHECK-NEXT: PropSet v0, v41 key="position"
// CHECK-NEXT: v43 = ElemGet v5, v10
// CHECK-NEXT: Return v43
// CHECK-NEXT: b11():
// CHECK-NEXT: v44 = CollectionIteratorClosedMark
// CHECK-NEXT: Return v44
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nextOfStepsOverText"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[HasThis, IsChecked, IsHiddenInStackTraces, HasExplicitName] enclosingRuntimeFunction=IteratorConsumersNextOfStepsOverText thisType={type=undefined|null|[[L_120]] flags=[OmitsNull, OmitsUndefined]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_120]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_121]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="stepOverText"
// CHECK-NEXT: v3 = IsCollectionIteratorClosedMark v2
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = Data data=[[d_122]]
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = Boolean
// CHECK-NEXT: v9 = NewObject -, v2, v8 layout=[[L_123]] fields=[1, 0]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: Jump -> next b3(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="openIterator"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 enclosingRuntimeFunction=IteratorConsumersOpenIterator thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key=@@iterator
// CHECK-NEXT: v2 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b7(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NarrowByTest v1, v3
// CHECK-NEXT: v5 = TypeTest v0 testedType=string
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4()
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = NarrowByTest v0, v6
// CHECK-NEXT: v8 = Builtin builtin=StringPrototypeSymbolIterator [isNotReadFromHolder]
// CHECK-NEXT: v9 = StrictEq v4, v8
// CHECK-NEXT: Branch v9 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Convert v7 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = Convert v11 declared={type=number}
// CHECK-NEXT: v13 = Builtin builtin=CompilerHelpersNextOfStepsOverText [isNotReadFromHolder]
// CHECK-NEXT: v14 = NewObject -, v10, v12, v13 layout=[[L_120]] fields=[2, 1, 0]
// CHECK-NEXT: v15 = FinishObject v14
// CHECK-NEXT: Return v15
// CHECK-NEXT: b4():
// CHECK-NEXT: v16 = Call v4, v0
// CHECK-NEXT: v17 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: v19 = NarrowByTest v16, v18
// CHECK-NEXT: Return v19
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = ThrowNewError errorKind=TypeError message="Iterator result interface is not an object."
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="openWrappedIterator"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 enclosingRuntimeFunction=IteratorConsumersOpenWrappedIterator thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key=@@iterator
// CHECK-NEXT: v2 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b4(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NarrowByTest v1, v3
// CHECK-NEXT: v5 = Call v4, v0
// CHECK-NEXT: v6 = TypeTest v5 testedType=object
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = NarrowByTest v5, v7
// CHECK-NEXT: v9 = Builtin builtin=LinkTimeConstantAsyncFromSyncIteratorCreate [isNotReadFromHolder]
// CHECK-NEXT: v10 = Call v9, -, v8
// CHECK-NEXT: ReturnCall v10
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = ThrowNewError errorKind=TypeError message="iterator method should return an object"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = ThrowNewError errorKind=TypeError message="iterable should have an iterator symbol"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="stepIterator"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 enclosingRuntimeFunction=IteratorConsumersStepIterator thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = HasJSType v0 first=5 last=5
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b5(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Builtin builtin=ArrayIteratorPrototypeNext [isNotReadFromHolder]
// CHECK-NEXT: v6 = StrictEq v1, v5
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b26()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v8 = StepArrayIterator v7
// CHECK-NEXT: v9 = ResultAt v8 index=1
// CHECK-NEXT: v10 = ResultAt v8
// CHECK-NEXT: v11 = ToBoolean v10
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(v9)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: v13 = CollectionIteratorClosedMark
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Return v14
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: v16 = HasJSType v0 first=7 last=7
// CHECK-NEXT: v17 = ToBoolean v16
// CHECK-NEXT: Branch v17 -> taken b6(| 0), notTaken b10(| 0)
// CHECK-NEXT: b6(v18):
// CHECK-NEXT: v19 = Builtin builtin=MapIteratorPrototypeNext [isNotReadFromHolder]
// CHECK-NEXT: v20 = StrictEq v1, v19
// CHECK-NEXT: Branch v20 -> taken b7(), notTaken b26()
// CHECK-NEXT: b7():
// CHECK-NEXT: v21 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v22 = StepMapIterator v21
// CHECK-NEXT: v23 = ResultAt v22 index=1
// CHECK-NEXT: v24 = ResultAt v22
// CHECK-NEXT: v25 = ToBoolean v24
// CHECK-NEXT: Branch v25 -> taken b8(| 0), notTaken b9(v23)
// CHECK-NEXT: b8(v26):
// CHECK-NEXT: v27 = CollectionIteratorClosedMark
// CHECK-NEXT: Jump -> next b9(v27)
// CHECK-NEXT: b9(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: b10(v29):
// CHECK-NEXT: v30 = HasJSType v0 first=10 last=10
// CHECK-NEXT: v31 = ToBoolean v30
// CHECK-NEXT: Branch v31 -> taken b11(| 0), notTaken b15(| 0)
// CHECK-NEXT: b11(v32):
// CHECK-NEXT: v33 = Builtin builtin=SetIteratorPrototypeNext [isNotReadFromHolder]
// CHECK-NEXT: v34 = StrictEq v1, v33
// CHECK-NEXT: Branch v34 -> taken b12(), notTaken b26()
// CHECK-NEXT: b12():
// CHECK-NEXT: v35 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v36 = StepSetIterator v35
// CHECK-NEXT: v37 = ResultAt v36 index=1
// CHECK-NEXT: v38 = ResultAt v36
// CHECK-NEXT: v39 = ToBoolean v38
// CHECK-NEXT: Branch v39 -> taken b13(| 0), notTaken b14(v37)
// CHECK-NEXT: b13(v40):
// CHECK-NEXT: v41 = CollectionIteratorClosedMark
// CHECK-NEXT: Jump -> next b14(v41)
// CHECK-NEXT: b14(v42):
// CHECK-NEXT: Return v42
// CHECK-NEXT: b15(v43):
// CHECK-NEXT: v44 = Builtin builtin=GeneratorPrototypeNext [isNotReadFromHolder]
// CHECK-NEXT: v45 = StrictEq v1, v44
// CHECK-NEXT: Branch v45 -> taken b16(), notTaken b24()
// CHECK-NEXT: b16():
// CHECK-NEXT: v46 = Undefined
// CHECK-NEXT: v47 = StepGenerator v0, v46 check=IsGenerator
// CHECK-NEXT: v48 = ResultAt v47
// CHECK-NEXT: v49 = ResultAt v47 index=1
// CHECK-NEXT: v50 = Integer integer=2
// CHECK-NEXT: v51 = StrictEq v49, v50
// CHECK-NEXT: Branch v51 -> taken b17(), notTaken b21()
// CHECK-NEXT: b17():
// CHECK-NEXT: v52 = Undefined
// CHECK-NEXT: v53 = ResumeGenerator v0, v52
// CHECK-NEXT: v54 = PropGet v53 key="done"
// CHECK-NEXT: v55 = Boolean boolean=true
// CHECK-NEXT: v56 = StrictEq v54, v55
// CHECK-NEXT: Branch v56 -> taken b18(| 0), notTaken b19(| 0)
// CHECK-NEXT: b18(v57):
// CHECK-NEXT: v58 = NarrowByField v53, v57 key="done"
// CHECK-NEXT: v59 = CollectionIteratorClosedMark
// CHECK-NEXT: Jump -> next b20(v59)
// CHECK-NEXT: b19(v60):
// CHECK-NEXT: v61 = NarrowByField v53, v60 key="done"
// CHECK-NEXT: v62 = PropGet v61 key="value"
// CHECK-NEXT: Jump -> next b20(v62)
// CHECK-NEXT: b20(v63):
// CHECK-NEXT: Return v63
// CHECK-NEXT: b21():
// CHECK-NEXT: v64 = Integer integer=1
// CHECK-NEXT: v65 = StrictEq v49, v64
// CHECK-NEXT: Branch v65 -> taken b22(), notTaken b23(v48)
// CHECK-NEXT: b22():
// CHECK-NEXT: v66 = CollectionIteratorClosedMark
// CHECK-NEXT: Jump -> next b23(v66)
// CHECK-NEXT: b23(v67):
// CHECK-NEXT: Return v67
// CHECK-NEXT: b24():
// CHECK-NEXT: v68 = Builtin builtin=CompilerHelpersNextOfStepsOverText [isNotReadFromHolder]
// CHECK-NEXT: v69 = StrictEq v1, v68
// CHECK-NEXT: Branch v69 -> taken b25(), notTaken b26()
// CHECK-NEXT: b25():
// CHECK-NEXT: v70 = GetModuleVariable variable=[[g_121]]
// CHECK-NEXT: v71 = Convert v0 declared={type=undefined|null|[[L_120]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v72 = Call v70, -, v71 calleeName="stepOverText"
// CHECK-NEXT: ReturnCall v72
// CHECK-NEXT: b26():
// CHECK-NEXT: v73 = Call v1, v0
// CHECK-NEXT: v74 = RequireObject v73 runtimeError=IteratorResultNotObject
// CHECK-NEXT: v75 = PropGet v74 key="done"
// CHECK-NEXT: v76 = ToBoolean v75
// CHECK-NEXT: Branch v76 -> taken b27(| 0), notTaken b28(| 0)
// CHECK-NEXT: b27(v77):
// CHECK-NEXT: v78 = CollectionIteratorClosedMark
// CHECK-NEXT: Jump -> next b29(v78)
// CHECK-NEXT: b28(v79):
// CHECK-NEXT: v80 = PropGet v74 key="value"
// CHECK-NEXT: Jump -> next b29(v80)
// CHECK-NEXT: b29(v81):
// CHECK-NEXT: Return v81
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="closeIterator"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 enclosingRuntimeFunction=IteratorConsumersCloseIterator thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="return"
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b2(), notTaken b1(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = Call v3, v0
// CHECK-NEXT: v5 = RequireObject v4 runtimeError=IteratorResultNotObject
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="closeIteratorAfterThrow"
// CHECK: module=[[m_113]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 enclosingRuntimeFunction=IteratorConsumersCloseIteratorAfterThrow thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByTest v0, v4
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b7():
// CHECK-NEXT: v6 = PropGet v5 key="return"
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v8) handler=b7():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b5(v9) handler=b7():
// CHECK-NEXT: v10 = Call v9, v5
// CHECK-NEXT: v11 = RequireObject v10 runtimeError=IteratorResultNotObject
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b7() role=CatchHandler:
// CHECK-NEXT: v13 = CatchValue
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="importRejectedByLoader"
// CHECK: module=[[m_124]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 enclosingRuntimeFunction=RejectedImportsImportRejectedByLoader thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Promise<never> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = NewPromise
// CHECK-NEXT: v2 = LinkTimeConstant constant=2
// CHECK-NEXT: v3 = Call v2, -, v1, v0
// CHECK-NEXT: v4 = NewPromise
// CHECK-NEXT: v5 = LinkTimeConstant constant=3
// CHECK-NEXT: v6 = Call v5, -, v4, v1
// CHECK-NEXT: v7 = Convert v4 declared={type=undefined|null|Promise<never> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="lastPieceOfSplit"
// CHECK: module=[[m_125]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 enclosingRuntimeFunction=StringSplitsLastPieceOfSplit thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|string):
// CHECK-NEXT: v2 = PropGet v1 key="length"
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: v5 = PropGet v0 key="indexOf"
// CHECK-NEXT: v6 = Call v5, v0, v1 calleeKey="indexOf" calleeName="text.indexOf"
// CHECK-NEXT: v7 = Convert v6 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b1(v4, v7)
// CHECK-NEXT: b1(v8: number, v9: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = GreaterEq v9, v11
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = Add v9, v2
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = BitOr v13, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number}
// CHECK-NEXT: v17 = PropGet v0 key="indexOf"
// CHECK-NEXT: v18 = Call v17, v0, v1, v16 calleeKey="indexOf" calleeName="text.indexOf"
// CHECK-NEXT: v19 = Convert v18 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b1(v16, v19)
// CHECK-NEXT: b3():
// CHECK-NEXT: v20 = PropGet v0 key="substring"
// CHECK-NEXT: v21 = Call v20, v0, v8 calleeKey="substring" calleeName="text.substring"
// CHECK-NEXT: ReturnCall v21 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="numberOfPiecesOfSplit"
// CHECK: module=[[m_125]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 enclosingRuntimeFunction=StringSplitsNumberOfPiecesOfSplit thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|string):
// CHECK-NEXT: v2 = PropGet v1 key="length"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: v5 = PropGet v0 key="indexOf"
// CHECK-NEXT: v6 = Call v5, v0, v1 calleeKey="indexOf" calleeName="text.indexOf"
// CHECK-NEXT: v7 = Convert v6 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b1(v4, v7)
// CHECK-NEXT: b1(v8: number, v9: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = GreaterEq v9, v11
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = Integer integer=1
// CHECK-NEXT: v14 = Add v8, v13
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = URShift v14, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: v18 = PropGet v0 key="indexOf"
// CHECK-NEXT: v19 = Add v9, v2
// CHECK-NEXT: v20 = Integer
// CHECK-NEXT: v21 = BitOr v19, v20
// CHECK-NEXT: v22 = Call v18, v0, v1, v21 calleeKey="indexOf" calleeName="text.indexOf"
// CHECK-NEXT: v23 = Convert v22 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b1(v17, v23)
// CHECK-NEXT: b3():
// CHECK-NEXT: v24 = Convert v8 declared={type=number}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="checkedArrayLength"
// CHECK: module=[[m_126]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 enclosingRuntimeFunction=WrittenListsCheckedArrayLength thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b4()
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = BitOr v3, v4
// CHECK-NEXT: v6 = StrictEq v5, v3
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = GreaterEq v3, v7
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v3
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v10 = Convert v0 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v11 = Construct v9, -, v10 calleeName="Array"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="from"
// CHECK: module=[[m_126]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=2 enclosingRuntimeFunction=WrittenListsArrayFromLength thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b11()
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NarrowByTest v0, v3
// CHECK-NEXT: v5 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b11()
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = NarrowByTest v1, v6
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = BitOr v4, v8
// CHECK-NEXT: v10 = StrictEq v9, v4
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b11()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = Integer
// CHECK-NEXT: v12 = GreaterEq v9, v11
// CHECK-NEXT: Branch v12 -> taken b4(), notTaken b11()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: v14 = Convert v9 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v15 = NewArrayLike v14, v13
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v17)
// CHECK-NEXT: b5(v18: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: Jump -> next b6(v18)
// CHECK-NEXT: b6(v20: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v22 = Less v20, v9
// CHECK-NEXT: Branch v22 -> taken b7(), notTaken b10()
// CHECK-NEXT: b7():
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: v24 = Call v7, -, v23, v20 calleeName="mapper"
// CHECK-NEXT: v25 = Convert v15 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v26 = Convert v20 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v27 = TryPutByValDirect v25, v26, v24
// CHECK-NEXT: v28 = Convert v27 declared={type=boolean}
// CHECK-NEXT: v29 = ToBoolean v28
// CHECK-NEXT: Branch v29 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v30):
// CHECK-NEXT: v31 = Increment v20
// CHECK-NEXT: v32 = Convert v31 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v32)
// CHECK-NEXT: b9(v33):
// CHECK-NEXT: ElemSet v15, v20, v24
// CHECK-NEXT: v35 = Integer integer=1
// CHECK-NEXT: v36 = Add v20, v35
// CHECK-NEXT: v37 = Integer
// CHECK-NEXT: v38 = URShift v36, v37
// CHECK-NEXT: v39 = Convert v38 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v39)
// CHECK-NEXT: b10():
// CHECK-NEXT: v40 = Convert v15 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v40
// CHECK-NEXT: b11():
// CHECK-NEXT: v41 = NewObject -, v0 layout=[[L_127]] fields=[0]
// CHECK-NEXT: v42 = FinishObject v41
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|Array<undefined> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v44 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v45 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v46 = Convert v1 declared={type=undefined|null|[[f_128]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v47 = Call v45, v44, v43, v46 calleeName="Array.from"
// CHECK-NEXT: ReturnCall v47 casts=[{declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="from"
// CHECK: module=[[m_126]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=2 enclosingRuntimeFunction=WrittenListsArrayFromList thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = HasJSType v0
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b11()
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = TypeTest v1 testedType=function
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b11()
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = NarrowByTest v1, v6
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v11 = NewArrayLike v10, v8
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = Convert v12 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v13)
// CHECK-NEXT: b3(v14: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: Jump -> next b4(v14)
// CHECK-NEXT: b4(v16: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v18 = PropGet v8 key="length"
// CHECK-NEXT: v19 = Less v16, v18
// CHECK-NEXT: Branch v19 -> taken b5(), notTaken b8()
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = ElemGet v8, v16
// CHECK-NEXT: v21 = Call v7, -, v20, v16 calleeName="mapper"
// CHECK-NEXT: v22 = Convert v11 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v23 = Convert v16 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v24 = TryPutByValDirect v22, v23, v21
// CHECK-NEXT: v25 = Convert v24 declared={type=boolean}
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v27):
// CHECK-NEXT: v28 = Increment v16
// CHECK-NEXT: v29 = Convert v28 declared={type=number}
// CHECK-NEXT: Jump -> next b4(v29)
// CHECK-NEXT: b7(v30):
// CHECK-NEXT: ElemSet v11, v16, v21
// CHECK-NEXT: v32 = Integer integer=1
// CHECK-NEXT: v33 = Add v16, v32
// CHECK-NEXT: v34 = Integer
// CHECK-NEXT: v35 = URShift v33, v34
// CHECK-NEXT: v36 = Convert v35 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v36)
// CHECK-NEXT: b8():
// CHECK-NEXT: v37 = StrictEq v16, v9
// CHECK-NEXT: Branch v37 -> taken b10(v11), notTaken b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v38 = Convert v11 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v39 = Convert v16 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v40 = TruncateNewArray v38, v39
// CHECK-NEXT: Jump -> next b10(v40)
// CHECK-NEXT: b10(v41):
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v42
// CHECK-NEXT: b11():
// CHECK-NEXT: v43 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v44 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v45 = Convert v0 declared={type=undefined|null|string|Array flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v46 = Convert v1 declared={type=undefined|null|[[f_129]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v47 = Call v44, v43, v45, v46 calleeName="Array.from"
// CHECK-NEXT: ReturnCall v47 casts=[{declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="arrayOfUndefined"
// CHECK: module=[[m_126]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=1 enclosingRuntimeFunction=WrittenListsArrayOfUndefined thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<undefined> flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b12()
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NarrowByTest v0, v2
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = BitOr v3, v4
// CHECK-NEXT: v6 = StrictEq v5, v3
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b12()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = GreaterEq v5, v7
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b12()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = Convert v5 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v11 = NewArrayLike v10, v9
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = Convert v11 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v14 = TryFillNewArray v13, v12
// CHECK-NEXT: v15 = ToBoolean v14
// CHECK-NEXT: Branch v15 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: v17 = Convert v11 declared={type=undefined|null|Array<undefined> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: v19 = Integer
// CHECK-NEXT: v20 = Convert v19 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v20)
// CHECK-NEXT: b6(v21: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: Jump -> next b7(v21)
// CHECK-NEXT: b7(v23: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v25 = Less v23, v5
// CHECK-NEXT: Branch v25 -> taken b8(), notTaken b11()
// CHECK-NEXT: b8():
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: v27 = Convert v11 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v28 = Convert v23 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v29 = TryPutByValDirect v27, v28, v26
// CHECK-NEXT: v30 = Convert v29 declared={type=boolean}
// CHECK-NEXT: v31 = ToBoolean v30
// CHECK-NEXT: Branch v31 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v32):
// CHECK-NEXT: v33 = Increment v23
// CHECK-NEXT: v34 = Convert v33 declared={type=number}
// CHECK-NEXT: Jump -> next b7(v34)
// CHECK-NEXT: b10(v35):
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: ElemSet v11, v23, v36
// CHECK-NEXT: v38 = Integer integer=1
// CHECK-NEXT: v39 = Add v23, v38
// CHECK-NEXT: v40 = Integer
// CHECK-NEXT: v41 = URShift v39, v40
// CHECK-NEXT: v42 = Convert v41 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v42)
// CHECK-NEXT: b11():
// CHECK-NEXT: v43 = Convert v11 declared={type=undefined|null|Array<undefined> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v43
// CHECK-NEXT: b12():
// CHECK-NEXT: v44 = NewObject -, v0 layout=[[L_127]] fields=[0]
// CHECK-NEXT: v45 = FinishObject v44
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|Array<undefined> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v47 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v48 = IsPristineArray v46
// CHECK-NEXT: Branch v48 -> taken b13(), notTaken b14()
// CHECK-NEXT: b13():
// CHECK-NEXT: v49 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v49, v46
// CHECK-NEXT: v51 = Convert v49 declared={type=undefined|null|Array<undefined> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b16(v51)
// CHECK-NEXT: b14():
// CHECK-NEXT: v52 = TypeTest v46 testedType=string
// CHECK-NEXT: Branch v52 -> taken b15(| 0), notTaken b17(| 0)
// CHECK-NEXT: b15(v53):
// CHECK-NEXT: v54 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v54, v53
// CHECK-NEXT: v56 = Convert v54 declared={type=undefined|null|Array<undefined> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b16(v56)
// CHECK-NEXT: b16(v57):
// CHECK-NEXT: v58 = Convert v57 declared={type=undefined|null|Array<undefined> flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: Return v58
// CHECK-NEXT: b17(v59):
// CHECK-NEXT: v60 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v61 = Builtin builtin=ArrayFrom [isNotReadFromHolder]
// CHECK-NEXT: v62 = Call v61, v60, v59
// CHECK-NEXT: ReturnCall v62 casts=[{declared={type=undefined|null|Array<undefined> flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined> flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined> flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="filledArray"
// CHECK: module=[[m_126]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, IsHiddenInStackTraces, HasExplicitName] length=2 enclosingRuntimeFunction=WrittenListsFilledArray thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b12()
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NarrowByTest v0, v3
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = BitOr v4, v5
// CHECK-NEXT: v7 = StrictEq v6, v4
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b12()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = GreaterEq v6, v8
// CHECK-NEXT: Branch v9 -> taken b3(), notTaken b12()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = Convert v6 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v12 = NewArrayLike v11, v10
// CHECK-NEXT: v13 = Convert v12 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v14 = TryFillNewArray v13, v1
// CHECK-NEXT: v15 = ToBoolean v14
// CHECK-NEXT: Branch v15 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: v17 = Convert v12 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: v19 = Integer
// CHECK-NEXT: v20 = Convert v19 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v20)
// CHECK-NEXT: b6(v21: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: Jump -> next b7(v21)
// CHECK-NEXT: b7(v23: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v25 = Less v23, v6
// CHECK-NEXT: Branch v25 -> taken b8(), notTaken b11()
// CHECK-NEXT: b8():
// CHECK-NEXT: v26 = Convert v12 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v27 = Convert v23 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v28 = TryPutByValDirect v26, v27, v1
// CHECK-NEXT: v29 = Convert v28 declared={type=boolean}
// CHECK-NEXT: v30 = ToBoolean v29
// CHECK-NEXT: Branch v30 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v31):
// CHECK-NEXT: v32 = Increment v23
// CHECK-NEXT: v33 = Convert v32 declared={type=number}
// CHECK-NEXT: Jump -> next b7(v33)
// CHECK-NEXT: b10(v34):
// CHECK-NEXT: ElemSet v12, v23, v1
// CHECK-NEXT: v36 = Integer integer=1
// CHECK-NEXT: v37 = Add v23, v36
// CHECK-NEXT: v38 = Integer
// CHECK-NEXT: v39 = URShift v37, v38
// CHECK-NEXT: v40 = Convert v39 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v40)
// CHECK-NEXT: b11():
// CHECK-NEXT: v41 = Convert v12 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v41
// CHECK-NEXT: b12():
// CHECK-NEXT: v42 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v43 = Convert v0 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v44 = Construct v42, -, v43 calleeName="Array"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v46 = PropGet v45 key="fill"
// CHECK-NEXT: v47 = Call v46, v45, v1 calleeKey="fill" calleeName="made.fill"
// CHECK-NEXT: ReturnCall v47 casts=[{declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="map"
// CHECK: module=[[m_126]] position={{*}} text={{*}} kind=Method role=Library flags=[IsChecked, HasExplicitName] length=3 enclosingRuntimeFunction=WrittenListsMappedFilledArray thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b11()
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = NarrowByTest v0, v4
// CHECK-NEXT: v6 = TypeTest v2 testedType=function
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b11()
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = NarrowByTest v2, v7
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = BitOr v5, v9
// CHECK-NEXT: v11 = StrictEq v10, v5
// CHECK-NEXT: Branch v11 -> taken b3(), notTaken b11()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = GreaterEq v10, v12
// CHECK-NEXT: Branch v13 -> taken b4(), notTaken b11()
// CHECK-NEXT: b4():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = Convert v10 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v16 = NewArrayLike v15, v14
// CHECK-NEXT: v17 = Integer
// CHECK-NEXT: v18 = Convert v17 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v18)
// CHECK-NEXT: b5(v19: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: Jump -> next b6(v19)
// CHECK-NEXT: b6(v21: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v23 = Less v21, v10
// CHECK-NEXT: Branch v23 -> taken b7(), notTaken b10()
// CHECK-NEXT: b7():
// CHECK-NEXT: v24 = Call v8, -, v1, v21 calleeName="mapper"
// CHECK-NEXT: v25 = Convert v16 declared={type=Array flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v26 = Convert v21 declared={type=int flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v27 = TryPutByValDirect v25, v26, v24
// CHECK-NEXT: v28 = Convert v27 declared={type=boolean}
// CHECK-NEXT: v29 = ToBoolean v28
// CHECK-NEXT: Branch v29 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v30):
// CHECK-NEXT: v31 = Increment v21
// CHECK-NEXT: v32 = Convert v31 declared={type=number}
// CHECK-NEXT: Jump -> next b6(v32)
// CHECK-NEXT: b9(v33):
// CHECK-NEXT: ElemSet v16, v21, v24
// CHECK-NEXT: v35 = Integer integer=1
// CHECK-NEXT: v36 = Add v21, v35
// CHECK-NEXT: v37 = Integer
// CHECK-NEXT: v38 = URShift v36, v37
// CHECK-NEXT: v39 = Convert v38 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v39)
// CHECK-NEXT: b10():
// CHECK-NEXT: v40 = Convert v16 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v40
// CHECK-NEXT: b11():
// CHECK-NEXT: v41 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v42 = Convert v0 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v43 = Construct v41, -, v42 calleeName="Array"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v45 = PropGet v44 key="fill"
// CHECK-NEXT: v46 = Call v45, v44, v1 calleeKey="fill" calleeName="made.fill"
// CHECK-NEXT: v47 = Convert v46 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v48 = PropGet v47 key="map"
// CHECK-NEXT: v49 = Convert v2 declared={type=undefined|null|[[f_130]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v50 = Call v48, v47, v49 calleeKey="map" calleeName="map"
// CHECK-NEXT: ReturnCall v50 casts=[{declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_126]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_126]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_126]] role=Signature thisType={type=anything} results=[{type=anything}]
