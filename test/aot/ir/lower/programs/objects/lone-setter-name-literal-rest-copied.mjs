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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = NewClosure function=[[f_2]]
// CHECK-NEXT: DefineSetter v0, v1 key="b"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="rest"
// CHECK-NEXT: CopyDataProperties v0, v4
// CHECK-NEXT: v6 = FinishObject v0
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = Call v7, -, v6 calleeName="show"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = NewObject layout=[[L_1]]
// CHECK-NEXT: CopyDataProperties v10, v6
// CHECK-NEXT: v12 = FinishObject v10
// CHECK-NEXT: v13 = Call v9, -, v12 calleeName="show"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="text"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = String string=" "
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Builtin builtin=String
// CHECK-NEXT: v5 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: v7 = NarrowByTest v0, v6
// CHECK-NEXT: v8 = Call v7 calleeName="x"
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = NarrowByTest v0, v9
// CHECK-NEXT: v11 = TypeTest v10 testedType=function
// CHECK-NEXT: Branch v11 -> taken b6(v10), notTaken b3(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: v13 = TypeTest v12 testedType=null|object
// CHECK-NEXT: Branch v13 -> taken b4(| 0), notTaken b6(v10)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = TypeTest v10 testedType=null
// CHECK-NEXT: Branch v15 -> taken b6(v10), notTaken b5(| 0)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: v17 = NarrowByTest v0, v16
// CHECK-NEXT: v18 = PropGet v17 key="k"
// CHECK-NEXT: Jump -> next b6(v18)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = Call v4, -, v19 calleeName="String"
// CHECK-NEXT: v21 = Add v3, v20
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="b"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: PropSet v0, v1 key="kept"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
