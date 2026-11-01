// RUN: lower
// OPTIONS: builtin-modules

// `undefined!` and `null!` as placeholders for a `number`, `boolean` or numeric enum: `x!` tests nothing, and undefined and null pass every written type and stay what they are.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
enum Target { ES5, ES2015 }
attempt("variable, number", () => { let position: number = undefined!; return position })
attempt("variable, boolean", () => { let isStrict: boolean = undefined!; return isStrict })
attempt("variable, enum", () => { let target: Target = undefined!; return target })
attempt("variable, number, null", () => { let position: number = null!; return position })
let position = 0, isStrict = true, target = Target.ES2015
attempt("module variable cleared, number", () => { position = undefined! })
attempt("module variable cleared, boolean", () => { isStrict = undefined! })
attempt("module variable cleared, enum", () => { target = undefined! })
console.log(position, isStrict, target)
attempt("captured variable", () => { let pos: number = undefined!; return { get: () => pos, set: (p: number) => { pos = p } }.get() })
class Binder { label: string = null!; count: number = undefined! }
attempt("field of a class", () => Object.keys(new Binder()).join())
interface Links { type: string; id: number }
attempt("field of a literal", () => { const links: Links = { type: undefined!, id: undefined! }; return Object.keys(links).join() })
function visit(depth: number = undefined!): string { return String(depth) }
attempt("default of a parameter, taken", () => visit())
attempt("default of a parameter, not taken", () => visit(1))
// A type that names undefined takes it too.
attempt("variable, number | undefined", () => { let position: number | undefined = undefined!; return position })

// GENERATED: visit attempt Binder set
// CHECK-LABEL: function {{*}}name="visit"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|number site=[[w_1]]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_1]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b5(v4)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b5(v6):
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v6 calleeName="String"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": no error"
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v1 calleeName="f"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Call v6, v4, v8, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=":"
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="TypeError" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24 writtenExpression="e instanceof TypeError"
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v27):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v28 = String string="TypeError"
// CHECK-NEXT: Jump -> next b9(v28)
// CHECK-NEXT: b7(v29):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v30 = String string="other "
// CHECK-NEXT: v31 = Add v30, v14
// CHECK-NEXT: Jump -> next b9(v31)
// CHECK-NEXT: b9(v32):
// CHECK-NEXT: v33 = Call v19, v17, v21, v32 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Binder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_9]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=env [[L_10]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=number site=[[w_11]]}] results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: env [[L_10]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="pos"
// CHECK-NEXT: v4 = Convert v1 declared={type=number site=[[w_13]]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_10]]
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
