// RUN: lower
// OPTIONS: builtin-modules

// An array literal in a `switch` case holds the narrowed number; its element is incremented and then read in every way.
declare const console: { log(...a: unknown[]): void };
function row(name: string, f: () => unknown): void { let got: unknown; try { got = f(); } catch (e) { got = "threw " + (e as Error).name + " " + (e as Error).message; } console.log(name + ": " + got); }
function e1(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a[0]; } } }
row("read by a constant index", () => e1(1));
function e2(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; const i = a.length - 1; return a[i]; } } }
row("read by a computed index", () => e2(1));
function e3(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; let s = 0; for (const x of a) s += x; return s; } } }
row("for of", () => e3(1));
function e4(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; const [y] = a; return y; } } }
row("a pattern", () => e4(1));
function e5(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.at(0); } } }
row("at", () => e5(1));
function e6(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.pop(); } } }
row("pop", () => e6(1));
function e7(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.map(x => x + 1)[0]; } } }
row("map", () => e7(1));
function e8(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return [...a][0]; } } }
row("spread", () => e8(1));
function e9(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; let s = 0; a.forEach(x => { s += x; }); return s; } } }
row("forEach", () => e9(1));
function e10(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.reduce((p: number, c) => p + c, 0); } } }
row("reduce", () => e10(1));
function e11(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; const b = a; return b[0]; } } }
row("through another const", () => e11(1));
function first(z: number[]): number { return z[0]; }
function e12(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return first(a); } } }
row("handed to number[]", () => e12(1));
function e13(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.slice()[0]; } } }
row("slice", () => e13(1));
function e14(k: number) { switch (k) { case 1: { const a = [k]; let [w] = a; w++; return w; } } }
row("a let out of a pattern, incremented", () => e14(1));
function e15(k: number) { switch (k) { case 1: { const o = { a: [k] }; o.a[0]++; return o.a[0]; } } }
row("an array in a literal's property", () => e15(1));
function e16(k: number) { switch (k) { case 1: { const m = [[k]]; m[0][0]++; return m[0][0]; } } }
row("an array in an array", () => e16(1));
function e17(k: number) { switch (k) { case 1: { const a = [k]; const up = () => { a[0]++; }; up(); return a[0] === 1; } } }
row("compared behind a closure", () => e17(1));

// GENERATED: e12 e14 up
// CHECK-LABEL: function {{*}}name="e12"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Switch v0 cases=[1] -> case b2(| 0), otherwise b4()
// CHECK-NEXT: b2(v1):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = Convert v1 declared={type=1} illTypedCause=Assertion
// CHECK-NEXT: v3 = NewArray v2 contents=1
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<1> site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = ElemGet v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=1 site=[[w_4]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v8 = Increment v7
// CHECK-NEXT: v9 = Convert v8 declared={type=1 site=[[w_4]]} illTypedCause=SuppressedError
// CHECK-NEXT: ElemSet v4, v5, v9
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v12 = Call v11, -, v4 calleeName="first"
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=number site=[[w_6]]}}, {declared={type=undefined|number site=[[w_2]]}}]
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|number site=[[w_2]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="e14"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_7]]}] results=[{type=undefined|number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Switch v0 cases=[1] -> case b2(| 0), otherwise b9()
// CHECK-NEXT: b2(v1):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = Convert v1 declared={type=1} illTypedCause=Assertion
// CHECK-NEXT: v3 = NewArray v2 contents=1
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<1> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = IteratorOpen v4 elementCount=1 [isDestructuring]
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v6 = IteratorResume v5 stepIndex=0
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: v9 = Convert v8 declared={type=1} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b8():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: IteratorClose v5
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v11 = Increment v9
// CHECK-NEXT: v12 = Convert v11 declared={type=1 site=[[w_10]]} illTypedCause=SuppressedError
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|number site=[[w_8]]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b8() role=IterationCleanup subject=v5:
// CHECK-NEXT: v14 = CatchException
// CHECK-NEXT: IteratorClose v5 completion=Throw
// CHECK-NEXT: Rethrow v14
// CHECK-NEXT: b9():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|number site=[[w_8]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="up"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|Array<1> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<1>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=1 site=[[w_13]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = Convert v4 declared={type=1 site=[[w_13]]} illTypedCause=SuppressedError
// CHECK-NEXT: ElemSet v0, v1, v5
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
