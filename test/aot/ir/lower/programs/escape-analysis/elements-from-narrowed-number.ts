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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Switch v0 cases=[1] -> case b1(| 0), otherwise b2()
// CHECK-NEXT: b1(v1):
// CHECK-NEXT: v2 = NewArray v1 contents=anything
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = ElemGet v2, v3
// CHECK-NEXT: v5 = Increment v4
// CHECK-NEXT: ElemSet v2, v3, v5
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v8 = Call v7, -, v2 calleeName="first"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="e14"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Switch v0 cases=[1] -> case b1(| 0), otherwise b5()
// CHECK-NEXT: b1(v1):
// CHECK-NEXT: v2 = NewArray v1 contents=anything
// CHECK-NEXT: v3 = IteratorOpen v2 elementCount=1 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v4 = IteratorResume v3 stepIndex=0
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: v7 = Convert v6 declared={type=1}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: IteratorClose v3
// CHECK-NEXT: v9 = Increment v7
// CHECK-NEXT: v10 = Convert v9 declared={type=1}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4() role=IterationCleanup subject=v3:
// CHECK-NEXT: v11 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v11
// CHECK-NEXT: b5():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="up"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=anything variableName="a"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: ElemSet v0, v1, v3
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
