// RUN: lower
// OPTIONS: builtin-modules

// A lone setter under a name, literal, rest of spread is copied in behind the setter, spread.
const more = { v: () => "called" };
const held = { b: more.v };
const { drop, ...rest } = { drop: 0, a: 1, ...held };
const text = x => typeof x + " " + String(typeof x === "function" ? x() : typeof x === "object" && x !== null ? x.k : x);
function show(r) {
  const x = r.kept ?? r.b;
  console.log(text(x), typeof r.a, typeof r.kept);
}
function main() {
  const r = { set b(x) { this.kept = x; }, ...rest };
  show(r);
  show({ ...r });
}
try {
  main();
} catch (e) {
  console.log("threw", e.constructor.name);
}

// GENERATED: main text b
// CHECK-LABEL: function {{*}}name="main"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = NewClosure function=[[f_2]]
// CHECK-NEXT: DefineSetter v0, v1 key="b"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="rest"
// CHECK-NEXT: CopyDataProperties v0, v4
// CHECK-NEXT: v6 = FinishObject v0
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v9 = Call v8, -, v7 calleeName="show"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v11 = NewObject layout=[[L_1]]
// CHECK-NEXT: CopyDataProperties v11, v7
// CHECK-NEXT: v13 = FinishObject v11
// CHECK-NEXT: v14 = Call v10, -, v13 calleeName="show"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="text"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = String string=" "
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Builtin builtin=String
// CHECK-NEXT: v5 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Call v6 calleeName="x"
// CHECK-NEXT: Jump -> next b15(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = TypeTest v8 testedType=function
// CHECK-NEXT: Branch v9 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: Jump -> next b14(v10)
// CHECK-NEXT: b7(v11):
// CHECK-NEXT: v12 = TypeTest v11 testedType=null|object
// CHECK-NEXT: Branch v12 -> taken b8(| 0), notTaken b13(| 0)
// CHECK-NEXT: b8(v13):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v14 = TypeTest v13 testedType=null
// CHECK-NEXT: Branch v14 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v15):
// CHECK-NEXT: Jump -> next b14(v15)
// CHECK-NEXT: b11(v16):
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: v17 = PropGet v16 key="k"
// CHECK-NEXT: Jump -> next b15(v17)
// CHECK-NEXT: b13(v18):
// CHECK-NEXT: Jump -> next b14(v18)
// CHECK-NEXT: b14(v19):
// CHECK-NEXT: Jump -> next b15(v19)
// CHECK-NEXT: b15(v20):
// CHECK-NEXT: v21 = Call v4, -, v20 calleeName="String"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v23 = Add v3, v22
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="b"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v1 key="kept"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
