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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = NewObject layout=[[L_1]]
// CHECK-NEXT: PropDefine v2, v1 key="a"
// CHECK-NEXT: v4 = NewClosure function=[[f_2]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_3]]
// CHECK-NEXT: v6 = FinishClass v5 layout=[[L_3]]
// CHECK-NEXT: v7 = Construct v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: CopyDataProperties v2, v8
// CHECK-NEXT: v10 = FinishObject v2
// CHECK-NEXT: v11 = NewObject layout=[[L_1]]
// CHECK-NEXT: CopyDataProperties v11, v10
// CHECK-NEXT: v13 = NewClosure function=[[f_4]]
// CHECK-NEXT: DefineSetter v11, v13 key="b"
// CHECK-NEXT: v15 = FinishObject v11
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v18 = Call v17, -, v16 calleeName="show"
// CHECK-NEXT: v19 = Integer integer=5
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined flags=[IsExpected]}
// CHECK-NEXT: PropSet v16, v20 key="b"
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v23 = Call v22, -, v16 calleeName="show"
// CHECK-NEXT: v24 = Builtin builtin=Object
// CHECK-NEXT: v25 = Builtin builtin=ObjectEntries
// CHECK-NEXT: v26 = Call v25, v24, v16 calleeName="Object.entries"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|Array<undefined|null|Array<undefined|null|number|string>> flags=[IsExpected]}
// CHECK-NEXT: v28 = IteratorOpen v27
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v30 = IteratorResume v28
// CHECK-NEXT: v31 = ResultAt v30
// CHECK-NEXT: v32 = ResultAt v30 index=1
// CHECK-NEXT: Branch v31 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Return v33
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b12():
// CHECK-NEXT: v34 = IteratorOpen v32 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b11():
// CHECK-NEXT: v35 = IteratorResume v34 stepIndex=0
// CHECK-NEXT: v36 = ResultAt v35
// CHECK-NEXT: v37 = ResultAt v35 index=1
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v39 = IteratorResume v34 stepIndex=1
// CHECK-NEXT: v40 = ResultAt v39
// CHECK-NEXT: v41 = ResultAt v39 index=1
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b11():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b12():
// CHECK-NEXT: IteratorClose v34
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b12():
// CHECK-NEXT: v44 = Builtin builtin=GlobalThis
// CHECK-NEXT: v45 = PropGet v44 key="console" [isFreeName]
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v46 key="log"
// CHECK-NEXT: v48 = Convert v47 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v49 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v50 = CheckInitialized v49 name="text"
// CHECK-NEXT: v51 = Call v50, -, v42 calleeName="text"
// CHECK-NEXT: v52 = Convert v51 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v53 = Call v48, v46, v38, v52 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b11() role=IterationCleanup subject=v34 handler=b12():
// CHECK-NEXT: v54 = CatchException
// CHECK-NEXT: IteratorClose v34 completion=Throw
// CHECK-NEXT: Rethrow v54
// CHECK-NEXT: b12() role=IterationCleanup subject=v28:
// CHECK-NEXT: v56 = CatchException
// CHECK-NEXT: IteratorClose v28 completion=Throw
// CHECK-NEXT: Rethrow v56
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
