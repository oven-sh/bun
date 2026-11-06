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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = String string="x"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: v8 = ToPropertyKey v5
// CHECK-NEXT: v9 = Integer integer=2
// CHECK-NEXT: v10 = NewObject -, v7 layout=[[L_4]] fields=[0]
// CHECK-NEXT: ElemDefine v10, v8, v9
// CHECK-NEXT: v12 = FinishObject v10
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: v15 = Call v1, -, v14 calleeName="f"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = NewObject layout=[[L_8]]
// CHECK-NEXT: CopyDataProperties v17, v16
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = Convert v19 declared={type=number}
// CHECK-NEXT: PropDefine v17, v20 key="x"
// CHECK-NEXT: v22 = FinishObject v17
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[L_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="console" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="log"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v13 key="t"
// CHECK-NEXT: v30 = Builtin builtin=Object
// CHECK-NEXT: v31 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v32 = Call v31, v30, v13 calleeName="Object.keys"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|Array<undefined|null|string> site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v34 = PropGet v33 key="join"
// CHECK-NEXT: v35 = Call v34, v33 calleeKey="join" calleeName="join"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v37 = Call v3, -, v23 calleeName="take"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v39 = Builtin builtin=Object
// CHECK-NEXT: v40 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v41 = Call v40, v39, v23 calleeName="Object.keys"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|Array<undefined|null|string> site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v43 = PropGet v42 key="join"
// CHECK-NEXT: v44 = Call v43, v42 calleeKey="join" calleeName="join"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v46 = Call v28, v26, v29, v36, v38, v45 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v47 = Undefined
// CHECK-NEXT: Return v47
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_13]]}] results=[{type=undefined|null|[[L_6]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: v2 = String string="u"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = NewObject -, v1, v3 layout=[[L_6]] fields=[0, 1]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_6]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="take"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_8]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="t"
// CHECK-NEXT: v2 = PropGet v0 key="u"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="x"
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
