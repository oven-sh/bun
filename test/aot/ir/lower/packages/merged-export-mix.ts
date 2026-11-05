// One name declared with `export` and without: TS2395 to TypeScript, a type error, which is not reported. There is one variable, as in what Bun's
// transpiler prints: the second declaration takes what the variable holds and makes an object only where it holds nothing.
// Inside a namespace an exported second declaration asks the namespace's object instead, where a first one without `export` is not: `K = Outer.K ||= {}`.
// What lies inside such a name lies in two tables: `A.B` of the block with `export` and `A.B` of the block without are one object too.
// The last file has no error: each block of a namespace has a scope of its own, and what both export is one object.
// RUN: link
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
