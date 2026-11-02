// RUN: lower
// OPTIONS: builtin-modules

interface S0 { kind: "s0"; a0: number }
interface S1 { kind: "s1"; a1: number }
interface S2 { kind: "s2"; a2: number }
interface S3 { kind: "s3"; a3: number }
interface S4 { kind: "s4"; a4: number }
interface S5 { kind: "s5"; a5: number }
interface S6 { kind: "s6"; a6: number }
interface S7 { kind: "s7"; a7: number }
interface S8 { kind: "s8"; a8: number }
interface S9 { kind: "s9"; a9: number }
interface S10 { kind: "s10"; a10: number }
interface S11 { kind: "s11"; a11: number }
interface S12 { kind: "s12"; a12: number }
interface S13 { kind: "s13"; a13: number }
interface S14 { kind: "s14"; a14: number }
interface S15 { kind: "s15"; a15: number }
interface S16 { kind: "s16"; a16: number }
interface S17 { kind: "s17"; a17: number }
interface S18 { kind: "s18"; a18: number }
interface S19 { kind: "s19"; a19: number }
type S = S0 | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | S13 | S14 | S15 | S16 | S17 | S18 | S19;
interface Box<T> { held: T }
interface Big { id: number; more: string }
interface Small { id: number }
interface H0 { kind: "h0"; on0: (from: Big) => Small }
interface H1 { kind: "h1"; on1: (from: Big) => Small }
interface H2 { kind: "h2"; on2: (from: Big) => Small }
interface H3 { kind: "h3"; on3: (from: Big) => Small }
interface H4 { kind: "h4"; on4: (from: Big) => Small }
interface H5 { kind: "h5"; on5: (from: Big) => Small }
interface H6 { kind: "h6"; on6: (from: Big) => Small }
interface H7 { kind: "h7"; on7: (from: Big) => Small }
interface H8 { kind: "h8"; on8: (from: Big) => Small }
interface H9 { kind: "h9"; on9: (from: Big) => Small }
interface H10 { kind: "h10"; on10: (from: Big) => Small }
interface H11 { kind: "h11"; on11: (from: Big) => Small }
interface H12 { kind: "h12"; on12: (from: Big) => Small }
interface H13 { kind: "h13"; on13: (from: Big) => Small }
interface H14 { kind: "h14"; on14: (from: Big) => Small }
interface H15 { kind: "h15"; on15: (from: Big) => Small }
interface H16 { kind: "h16"; on16: (from: Big) => Small }
interface H17 { kind: "h17"; on17: (from: Big) => Small }
interface H18 { kind: "h18"; on18: (from: Big) => Small }
interface H19 { kind: "h19"; on19: (from: Big) => Small }
type H = H0 | H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | H11 | H12 | H13 | H14 | H15 | H16 | H17 | H18 | H19 | Box<Small> | { [key: string]: Small } | ((from: Big) => Small);
function pick(s: S): number {
  if (s.kind === "s0") return s.a0;
  if (s.kind === "s1") return s.a1;
  if (s.kind === "s2") return s.a2;
  if (s.kind === "s3") return s.a3;
  if (s.kind === "s4") return s.a4;
  if (s.kind === "s5") return s.a5;
  if (s.kind === "s6") return s.a6;
  if (s.kind === "s7") return s.a7;
  if (s.kind === "s8") return s.a8;
  if (s.kind === "s9") return s.a9;
  if (s.kind === "s10") return s.a10;
  if (s.kind === "s11") return s.a11;
  if (s.kind === "s12") return s.a12;
  if (s.kind === "s13") return s.a13;
  if (s.kind === "s14") return s.a14;
  if (s.kind === "s15") return s.a15;
  if (s.kind === "s16") return s.a16;
  if (s.kind === "s17") return s.a17;
  if (s.kind === "s18") return s.a18;
  return s.a19;
}
const all: S[] = [{ kind: "s0", a0: 0 }, { kind: "s1", a1: 1 }, { kind: "s2", a2: 2 }, { kind: "s3", a3: 3 }, { kind: "s4", a4: 4 }, { kind: "s5", a5: 5 }, { kind: "s6", a6: 6 }, { kind: "s7", a7: 7 }, { kind: "s8", a8: 8 }, { kind: "s9", a9: 9 }, { kind: "s10", a10: 10 }, { kind: "s11", a11: 11 }, { kind: "s12", a12: 12 }, { kind: "s13", a13: 13 }, { kind: "s14", a14: 14 }, { kind: "s15", a15: 15 }, { kind: "s16", a16: 16 }, { kind: "s17", a17: 17 }, { kind: "s18", a18: 18 }, { kind: "s19", a19: 19 }];
const big: Big = { id: 7, more: "m" };
const boxed: Box<Big> = { held: big };
const byKey: { [key: string]: Big } = { one: big };
const handler: H3 = { kind: "h3", on3: from => ({ id: from.id + 1 }) };
const plain = (from: Small): Big => ({ id: from.id + 2, more: "f" });
const taken: H[] = [boxed, byKey, handler, plain];
function idOf(h: H): number {
  if (typeof h === "function") return h(big).id;
  if ("held" in h) return (h as Box<Small>).held.id;
  if ("kind" in h && typeof h.kind === "string") return (h as H3).on3(big).id;
  return (h as { [key: string]: Small }).one.id;
}
console.log(all.map(pick).join(), taken.map(idOf).join());

// GENERATED: idOf on3
// CHECK-LABEL: function {{*}}name="idOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_4]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="big"
// CHECK-NEXT: v6 = Call v3, -, v5 calleeName="h"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="id"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v11 = PropHas v10 key="held"
// CHECK-NEXT: v12 = ToBoolean v11
// CHECK-NEXT: Branch v12 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v14 = Convert v10 declared={type=undefined|null|[[L_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v15 = PropGet v14 key="held"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_6]] site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v17 = PropGet v16 key="id"
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: b8(v19):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v20 = PropHas v10 key="kind"
// CHECK-NEXT: v21 = ToBoolean v20
// CHECK-NEXT: Branch v21 -> taken b10(| 0), notTaken b15(| 0)
// CHECK-NEXT: b10(v22):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v23 = PropGet v10 key="kind"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|"h0"|"h1"|"h10"|"h11"|"h12"|"h13"|"h14"|"h15"|"h16"|"h17"|"h18"|"h19"|"h2"|"h3"|"h4"|"h5"|"h6"|"h7"|"h8"|"h9"|[[L_6]] site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v25 = TypeTest v24 testedType=string
// CHECK-NEXT: Branch v25 -> taken b12(| 0), notTaken b14(| 0)
// CHECK-NEXT: b12(v26):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v27 = Convert v10 declared={type=undefined|null|[[L_12]]|[[L_13]]|[[L_14]]|[[L_15]]|[[L_16]]|[[L_17]]|[[L_18]]|[[L_19]]|[[L_20]]|[[L_21]]|[[L_22]]|[[L_23]]|[[L_24]]|[[L_25]]|[[L_26]]|[[L_27]]|[[L_28]]|[[L_29]]|[[L_30]]|[[L_31]]} illTypedCause=Assertion
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|[[L_12]] site=[[w_32]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v29 = PropGet v28 key="on3"
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="big"
// CHECK-NEXT: v32 = Call v29, v28, v31 calleeKey="on3" calleeName="h.on3"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|[[L_6]] site=[[w_33]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v34 = PropGet v33 key="id"
// CHECK-NEXT: v35 = Convert v34 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v35
// CHECK-NEXT: b14(v36):
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b15(v37):
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16():
// CHECK-NEXT: v38 = Convert v10 declared={type=undefined|null|object site=[[w_34]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v39 = PropGet v38 key="one"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|[[L_6]] site=[[w_35]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v41 = PropGet v40 key="id"
// CHECK-NEXT: v42 = Convert v41 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v42
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="on3"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_36]] site=[[w_37]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_6]] site=[[w_38]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_39]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_36]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="id"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_6]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_6]] site=[[w_38]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
