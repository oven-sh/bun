// RUN: lower
// OPTIONS: builtin-modules

// The result of an untyped function that is called through a type promising a primitive is checked where the call returns.
/* expected
a1 6
a2 TypeError
a3 TypeError
b1 s!
b2 TypeError
c1 true
c2 TypeError
c3 TypeError
d1 TypeError
d2 1,2
e1 TypeError
e2 3
f1 TypeError
f2 4
f3 TypeError
f4 big
f5 TypeError
f6 4
f7 object
f8 4
g1 TypeError
g2 ab
h1 TypeError
h2 10
i1 TypeError
i2 2
j1 51
j2 string
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const parse: (text: string) => number = JSON.parse
attempt("a1", () => parse("5") + 1)
attempt("a2", () => parse('"5"') + 1)
attempt("a3", () => parse("[5]") + 1)
const identity: (v: unknown) => string = (v: any) => v
attempt("b1", () => identity("s") + "!")
attempt("b2", () => identity(5) + "!")
function untyped(v: any) { return v }
function typed(v: any): boolean { return untyped(v) }
attempt("c1", () => typed(true))
attempt("c2", () => { const b: boolean = typed("true"); return b })
attempt("c3", () => { const b: boolean = typed(1); return b })
attempt("d1", () => ["a"].map((x: any): number => x).join())
attempt("d2", () => [1, 2].map((x: any): number => x).join())
const loose: any = (v: unknown) => v
attempt("e1", () => { const n: number = loose("3"); return n })
attempt("e2", () => { const n: number = loose(3); return n })
// Methods of objects of the program.
interface Api { size(): number }
const wrong: Api = { size: (): any => "big" }
const right: Api = { size: () => 3 }
attempt("f1", () => wrong.size() + 1)
attempt("f2", () => right.size() + 1)
attempt("f3", () => { const apis: Api[] = [right, wrong]; let s = 0; for (const a of apis) s += a.size(); return s })
attempt("f4", () => (wrong as any).size())
// An ordinary object (a literal checked against `any` is one) passes the cast as it is. Its function is called as the type says.
const plainWrong: any = { size: () => "big" }, plainRight: any = { size: () => 3 }
attempt("f5", () => (plainWrong as Api).size() + 1)
attempt("f6", () => (plainRight as Api).size() + 1)
// An object of the program that was created as another type passes the cast as it is.
attempt("f7", () => typeof ({ size: () => "big" } as unknown as Api))
attempt("f8", () => ({ size: () => 3 } as unknown as Api).size() + 1)
// A function value that travels through a field of function type.
interface Holder { make: (a: string, b: string) => string }
const holder: Holder = { make: (a, b) => a + b }
attempt("g1", () => { (holder as any).make = () => 7; return holder.make("a", "b").length })
attempt("g2", () => { (holder as any).make = (a: string, b: string) => a + b; return holder.make("a", "b") })
// Callbacks: the caller was promised a number.
function apply(f: (n: number) => number, n: number): number { return f(n) * 2 }
attempt("h1", () => apply(untyped.bind(null, "x"), 5))
attempt("h2", () => apply(untyped, 5))
// Accessors count as functions.
class Gauge { raw: any = 1; get level(): number { return this.raw } }
attempt("i1", () => { const g = new Gauge(); g.raw = "high"; return g.level + 1 })
attempt("i2", () => new Gauge().level + 1)
// Nothing was promised: nothing is checked.
attempt("j1", () => untyped("5") + 1)
attempt("j2", () => typeof loose("3"))

// GENERATED: typed apply attempt Gauge level make
// CHECK-LABEL: function {{*}}name="typed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean site=[[w_1]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="untyped"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=boolean site=[[w_1]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="apply"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_5]]}] results=[{type=number site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_3]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="f"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_7]]}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Mul v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v1 calleeName="f"
// CHECK-NEXT: v9 = Call v7, -, v8 calleeName="String"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = Call v6, v4, v0, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v12 = CatchValue
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = Convert v12 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v19 = PropGet v18 key="constructor"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|function site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v21 = PropGet v20 key="name"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v23 = Call v17, v15, v0, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Gauge"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_13]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_13]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_14]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="level"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_13]] site=[[w_15]]} results=[{type=number site=[[w_16]]}] {
// CHECK-NEXT: b0(v0: [[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="raw"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_16]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
