// RUN: lower
// CHECK-LABEL: function {{*}}name="double"
// CHECK: [[doubleTest]] = ToBoolean [[doubleX]]
// CHECK-NEXT: Branch [[doubleTest]] -> taken [[doubleTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[doubleTaken]]({{*}}):
// CHECK-NEXT: Jump -> next [[doubleArm]]()
// CHECK: [[doubleArm]]():
// CHECK-NEXT: [[doubleCallee]] = Convert {{*}} declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[doubleCallee]] calleeName="a"
// CHECK-LABEL: function {{*}}name="group"
// CHECK: [[first]] = ToBoolean [[groupX]]
// CHECK-NEXT: Branch [[first]] -> taken [[firstTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[firstTaken]]({{*}}):
// CHECK-NEXT: Jump -> next [[second]]()
// CHECK: [[second]]():
// CHECK-NEXT: [[secondTest]] = ToBoolean [[groupY]]
// CHECK-NEXT: Branch [[secondTest]] -> taken [[secondTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[secondTaken]]({{*}}):
// CHECK-NEXT: Jump -> next [[groupArm]]()
// CHECK: [[groupArm]]():
// CHECK-NEXT: [[groupCallee]] = Convert {{*}} declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[groupCallee]] calleeName="b"
// CHECK-LABEL: function {{*}}name="loop"
// CHECK: [[finished]] = Call {{*}}calleeName="done"
// CHECK-NEXT: [[loopTest]] = ToBoolean [[finished]]
// CHECK-NEXT: Branch [[loopTest]] -> taken {{*}}(| 0), notTaken [[loopOther]](| 0)
// CHECK: [[loopOther]]({{*}}):
// CHECK-NEXT: Jump -> next [[body]]()
// CHECK: [[body]]():
// CHECK-NEXT: [[loopCallee]] = Convert {{*}} declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[loopCallee]] calleeName="a"
// CHECK-LABEL: function {{*}}name="single"
// CHECK: [[singleTest]] = ToBoolean [[singleX]]
// CHECK-NEXT: Branch [[singleTest]] -> taken [[singleTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[singleTaken]]({{*}}):
// CHECK-NEXT: Jump -> next [[singleArm]]()
// CHECK: [[singleArm]]():
// CHECK-NEXT: [[singleCallee]] = Convert {{*}} declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[singleCallee]] calleeName="b"

// RUN(NOWHERE): lower
// NOWHERE-NOT: LogicalNot
// NOWHERE-NOT: = Boolean

export function double(x: any, a: any, b: any) {
  if (!!x) a();
  else b();
}

export function group(x: any, y: any, a: any, b: any) {
  if (!(x && y)) a();
  else b();
}

export function loop(done: any, a: any) {
  while (!done()) a();
}

export function single(x: any, a: any, b: any) {
  if (!x) a();
  else b();
}
