// RUN: lower
// CHECK-LABEL: function {{*}}name="and"
// CHECK: b0([[target]]: anything, [[f]]: anything):
// CHECK: [[andTest]] = ToBoolean [[target]]
// CHECK-NEXT: Branch [[andTest]] -> taken [[andAssign]](| 0), notTaken [[andKept]](| 0)
// CHECK: [[andF]] = Convert [[f]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[andAssigned]] = Call [[andF]] calleeName="f"
// CHECK-NEXT: Jump -> next [[andJoin]]([[andAssigned]])
// CHECK: [[andJoin]]([[andValue]]):
// CHECK-NEXT: Return [[andValue]]
// CHECK-LABEL: function {{*}}name="member"
// CHECK: [[object]] = Convert [[target]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[old]] = PropGet [[object]] key="p"
// CHECK-NEXT: [[memberTest]] = TypeTest [[old]] testedType=undefined|null
// CHECK-NOT: PropSet
// CHECK: [[memberF]] = Convert [[f]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[made]] = Call [[memberF]] calleeName="f"
// CHECK-NEXT: PropSet [[object]], [[made]] key="p"
// CHECK-NOT: PropSet
// CHECK-LABEL: function {{*}}name="named"
// CHECK: = TypeTest [[target]] testedType=undefined|null
// CHECK: = NewClosure function=
// CHECK-LABEL: function {{*}}name="nullish"
// CHECK-NOT: ToBoolean
// CHECK: [[nullishTest]] = TypeTest [[target]] testedType=undefined|null
// CHECK-NEXT: Branch [[nullishTest]] -> taken [[nullishAssign]](| 0), notTaken [[nullishKept]](| 0)
// CHECK-NOT: ToBoolean
// CHECK: [[nullishF]] = Convert [[f]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[nullishAssigned]] = Call [[nullishF]] calleeName="f"
// CHECK-NEXT: Jump -> next [[nullishJoin]]([[nullishAssigned]])
// CHECK-NOT: ToBoolean
// CHECK-LABEL: function {{*}}name="or"
// CHECK: [[orTest]] = ToBoolean [[target]]
// CHECK-NEXT: Branch [[orTest]] -> taken [[orKept]](| 0), notTaken [[orAssign]](| 0)
// CHECK: [[orF]] = Convert [[f]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: [[orAssigned]] = Call [[orF]] calleeName="f"
// CHECK-NEXT: Jump -> next [[orJoin]]([[orAssigned]])
// CHECK-LABEL: function {{*}}name="x"

// RUN(EFFECT): lower
// EFFECT-LABEL: function {{*}}name="member"
// EFFECT-NOT: Jump -> next {{*}}(v
// EFFECT-LABEL: function {{*}}name="named"

export function and(x: any, f: any): any {
  x &&= f();
  return x;
}

export function member(o: any, f: any) {
  o.p ??= f();
}

export function named(x: any): any {
  x ??= function () {};
  return x;
}

export function nullish(x: any, f: any): any {
  x ??= f();
  return x;
}

export function or(x: any, f: any): any {
  x ||= f();
  return x;
}
