// RUN: lower
// OPTIONS: builtin-modules

// A lone setter under a name, literal, spread of instance is copied in ahead of the setter, entries.
const more = { v: () => "called" };
const text = x => typeof x + " " + String(typeof x === "function" ? x() : typeof x === "object" && x !== null ? x.k : x);
function show(r) {
  const x = r.kept ?? r.b;
  console.log(text(x), typeof r.a, typeof r.kept);
}
function main() {
  const r = { ...{ a: 1, ...new (class { b = more.v; })() }, set b(x) { this.kept = x; } };
  show(r);
  r.b = 5;
  show(r);
  for (const [key, value] of Object.entries(r)) console.log(key, text(value));
}
try {
  main();
} catch (e) {
  console.log("threw", e.constructor.name);
}

// GENERATED: main b
// CHECK-LABEL: function {{*}}name="main"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = NewObject layout=[[L_1]]
// CHECK-NEXT: PropDefine v2, v1 key="a"
// CHECK-NEXT: v4 = NewClosure function=[[f_2]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_3]]
// CHECK-NEXT: v6 = FinishClass v5 layout=[[L_3]]
// CHECK-NEXT: v7 = Construct v6
// CHECK-NEXT: CopyDataProperties v2, v7
// CHECK-NEXT: v9 = FinishObject v2
// CHECK-NEXT: v10 = NewObject layout=[[L_1]]
// CHECK-NEXT: CopyDataProperties v10, v9
// CHECK-NEXT: v12 = NewClosure function=[[f_4]]
// CHECK-NEXT: DefineSetter v10, v12 key="b"
// CHECK-NEXT: v14 = FinishObject v10
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v16 = Call v15, -, v14 calleeName="show"
// CHECK-NEXT: v17 = Integer integer=5
// CHECK-NEXT: PropSet v14, v17 key="b"
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v20 = Call v19, -, v14 calleeName="show"
// CHECK-NEXT: v21 = Builtin builtin=Object
// CHECK-NEXT: v22 = Builtin builtin=ObjectEntries
// CHECK-NEXT: v23 = Call v22, v21, v14 calleeName="Object.entries"
// CHECK-NEXT: v24 = IteratorOpen v23
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v26 = IteratorResume v24
// CHECK-NEXT: v27 = ResultAt v26
// CHECK-NEXT: v28 = ResultAt v26 index=1
// CHECK-NEXT: Branch v27 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v30 = IteratorOpen v28 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v31 = IteratorResume v30 stepIndex=0
// CHECK-NEXT: v32 = ResultAt v31
// CHECK-NEXT: v33 = ResultAt v31 index=1
// CHECK-NEXT: v34 = IteratorResume v30 stepIndex=1
// CHECK-NEXT: v35 = ResultAt v34
// CHECK-NEXT: v36 = ResultAt v34 index=1
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b8():
// CHECK-NEXT: IteratorClose v30
// CHECK-NEXT: v38 = Builtin builtin=GlobalThis
// CHECK-NEXT: v39 = PropGet v38 key="console" [isFreeName]
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v41 = PropGet v40 key="log"
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v43 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v44 = CheckInitialized v43 name="text"
// CHECK-NEXT: v45 = Call v44, -, v36 calleeName="text"
// CHECK-NEXT: v46 = Call v42, v40, v33, v45 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b7() role=IterationCleanup subject=v30 handler=b8():
// CHECK-NEXT: v47 = CatchException
// CHECK-NEXT: IteratorClose v30 completion=Throw
// CHECK-NEXT: Rethrow v47
// CHECK-NEXT: b8() role=IterationCleanup subject=v24:
// CHECK-NEXT: v49 = CatchException
// CHECK-NEXT: IteratorClose v24 completion=Throw
// CHECK-NEXT: Rethrow v49
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="b"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: PropSet v0, v1 key="kept"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
