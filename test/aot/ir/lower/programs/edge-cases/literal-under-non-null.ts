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
// CHECK-NEXT: v8 = String string="x"
// CHECK-NEXT: v9 = ToPropertyKey v8
// CHECK-NEXT: v10 = Integer integer=2
// CHECK-NEXT: v11 = NewObject -, v7 layout=[[L_4]] fields=[0]
// CHECK-NEXT: ElemDefine v11, v9, v10
// CHECK-NEXT: v13 = FinishObject v11
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Call v1, -, v15 calleeName="f"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v18 = NewObject layout=[[L_8]]
// CHECK-NEXT: CopyDataProperties v18, v17
// CHECK-NEXT: v20 = Integer integer=1
// CHECK-NEXT: v21 = Convert v20 declared={type=number}
// CHECK-NEXT: PropDefine v18, v21 key="x"
// CHECK-NEXT: v23 = FinishObject v18
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v14 key="t"
// CHECK-NEXT: v31 = Builtin builtin=Object
// CHECK-NEXT: v32 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v33 = Call v32, v31, v14 calleeName="Object.keys"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|Array<undefined|null|string> site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v35 = PropGet v34 key="join"
// CHECK-NEXT: v36 = Call v35, v34 calleeKey="join" calleeName="join"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v38 = Call v3, -, v24 calleeName="take"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v40 = Builtin builtin=Object
// CHECK-NEXT: v41 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v42 = Call v41, v40, v24 calleeName="Object.keys"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|Array<undefined|null|string> site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v44 = PropGet v43 key="join"
// CHECK-NEXT: v45 = Call v44, v43 calleeKey="join" calleeName="join"
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v47 = Call v29, v27, v30, v37, v39, v46 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v48 = Undefined
// CHECK-NEXT: Return v48
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
