// RUN: lower
// CHECK-LABEL: function {{*}}name="and"
// CHECK: b0([[target]]: anything, [[f]]: anything):
// CHECK: [[andTest]] = ToBoolean [[target]]
// CHECK-NEXT: Branch [[andTest]] -> taken [[andAssign]](| 0), notTaken [[andJoin]]([[target]])
// CHECK: [[andAssigned]] = Call [[f]] calleeName="f"
// CHECK-NEXT: Jump -> next [[andJoin]]([[andAssigned]])
// CHECK: [[andJoin]]([[andValue]]):
// CHECK-NEXT: Return [[andValue]]
// CHECK-LABEL: function {{*}}name="member"
// CHECK: [[old]] = PropGet [[target]] key="p"
// CHECK-NEXT: [[memberTest]] = TypeTest [[old]] testedType=undefined|null
// CHECK-NOT: PropSet
// CHECK: [[made]] = Call [[f]] calleeName="f"
// CHECK-NEXT: PropSet [[target]], [[made]] key="p"
// CHECK-NOT: PropSet
// CHECK-LABEL: function {{*}}name="named"
// CHECK: = TypeTest [[target]] testedType=undefined|null
// CHECK: = NewClosure function=
// CHECK-LABEL: function {{*}}name="nullish"
// CHECK-NOT: ToBoolean
// CHECK: [[nullishTest]] = TypeTest [[target]] testedType=undefined|null
// CHECK-NEXT: Branch [[nullishTest]] -> taken [[nullishAssign]](| 0), notTaken [[nullishJoin]]([[target]])
// CHECK-NOT: ToBoolean
// CHECK: [[nullishAssigned]] = Call [[f]] calleeName="f"
// CHECK-NEXT: Jump -> next [[nullishJoin]]([[nullishAssigned]])
// CHECK-NOT: ToBoolean
// CHECK-LABEL: function {{*}}name="or"
// CHECK: [[orTest]] = ToBoolean [[target]]
// CHECK-NEXT: Branch [[orTest]] -> taken [[orJoin]]([[target]]), notTaken [[orAssign]](| 0)
// CHECK: [[orAssigned]] = Call [[f]] calleeName="f"
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
