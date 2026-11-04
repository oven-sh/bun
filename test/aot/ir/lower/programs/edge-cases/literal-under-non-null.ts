// RUN: lower
// OPTIONS: builtin-modules

// Literals with a computed key and with a spread stand under `!`.
declare const console: { log(...values: unknown[]): void };
const k = "x" as string;
const o = ({ t: 1, [k]: 2 })!;
function f(n: number) { return { t: n, u: "u" } }
const p = ({ ...f(1), x: 1 })!;
function take(v: { t: number; u: string; x: number }) { return v.t + v.u + v.x }
console.log(o.t, Object.keys(o).join(), take(p), Object.keys(p).join());

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_2]] flags=[IsFromCompiler]}
// CHECK-NEXT: v4 = String string="x"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = ToPropertyKey v5
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = NewObject -, v6 layout=[[L_3]] fields=[0]
// CHECK-NEXT: ElemDefine v9, v7, v8
// CHECK-NEXT: v11 = FinishObject v9
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Call v1, -, v12 calleeName="f"
// CHECK-NEXT: v14 = NewObject layout=[[L_4]]
// CHECK-NEXT: CopyDataProperties v14, v13
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: v17 = Convert v16 declared={type=number}
// CHECK-NEXT: PropDefine v14, v17 key="x"
// CHECK-NEXT: v19 = FinishObject v14
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v11 key="t"
// CHECK-NEXT: v26 = Builtin builtin=Object
// CHECK-NEXT: v27 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v28 = Call v27, v26, v11 calleeName="Object.keys"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v30 = PropGet v29 key="join"
// CHECK-NEXT: v31 = Call v30, v29 calleeKey="join" calleeName="join"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v33 = Call v3, -, v19 calleeName="take"
// CHECK-NEXT: v34 = Builtin builtin=Object
// CHECK-NEXT: v35 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v36 = Call v35, v34, v19 calleeName="Object.keys"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v38 = PropGet v37 key="join"
// CHECK-NEXT: v39 = Call v38, v37 calleeKey="join" calleeName="join"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v41 = Call v24, v22, v25, v32, v33, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v42 = Undefined
// CHECK-NEXT: Return v42
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = String string="u"
// CHECK-NEXT: v2 = NewObject -, v0, v1 layout=[[L_5]] fields=[0, 1]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="take"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: v1 = PropGet v0 key="t"
// CHECK-NEXT: v2 = PropGet v0 key="u"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="x"
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
