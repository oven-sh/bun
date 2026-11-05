// RUN: lower
// OPTIONS: builtin-modules

// Each line: the message of the ReferenceError of a pattern that stores to a variable ahead of its declaration. The stored output names the variable.
function one() {
  [a] = [1];
  let a;
}
function two() {
  ({ a } = { a: 1 });
  let a;
}
function three() {
  [a, b] = [1, 2];
  let a, b;
}
function four() {
  [[a]] = [[1]];
  let a;
}
function five() {
  [...a] = [1];
  let a;
}
function six() {
  [a = 2] = [];
  let a;
}
function seven() {
  a = 1;
  let a;
}
function eight() {
  ({ x: a } = { x: 1 });
  let a;
}
function nine() {
  for ([a] of [[1]]) {
  }
  let a;
}
function eleven() {
  [a] = [1];
  class a {}
}
for (const f of [one, two, three, four, five, six, seven, eight, nine, eleven]) {
  try {
    f();
    console.log(f.name, "no error");
  } catch (error) {
    console.log(f.name, error.name, error.message);
  }
}

// GENERATED: two five seven a
// CHECK-LABEL: function {{*}}name="two"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_2]]
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="a"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="a"
// CHECK-NEXT: v6 = Absent
// CHECK-NEXT: v7 = CheckInitialized v6 name="a"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="five"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_4]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v2 = IteratorOpen v1 elementCount=0 [isDestructuring, hasRest]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b9():
// CHECK-NEXT: v3 = NewArray contents=anything
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b9():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v2 stepIndex=0
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b4(), notTaken b8()
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: v8 = Absent
// CHECK-NEXT: v9 = CheckInitialized v8 name="a"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b9():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: IteratorClose v2
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: b8() handler=b9():
// CHECK-NEXT: AppendElement v3, v7
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b9() role=IterationCleanup subject=v2:
// CHECK-NEXT: v14 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="seven"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = CheckInitialized v2 name="a"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
