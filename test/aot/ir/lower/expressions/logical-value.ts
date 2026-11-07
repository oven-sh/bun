// RUN: lower
// CHECK-LABEL: function {{*}}name="and"
// CHECK: b0([[a]]: anything, [[b]]: anything):
// CHECK: [[andTest]] = ToBoolean [[a]]
// CHECK-NEXT: Branch [[andTest]] -> taken [[andRight]](| 0), notTaken [[andKept]](| 0)
// CHECK-NOT: Jump {{*}}([[a]])
// CHECK: [[andKept]]([[falsy]]):
// CHECK-NEXT: Jump -> next [[andJoin]]([[falsy]])
// CHECK-NOT: Jump {{*}}([[a]])
// CHECK-LABEL: function {{*}}name="nullish"
// CHECK-NOT: = ToBoolean
// CHECK: [[nullishTest]] = TypeTest [[a]] testedType=undefined|null
// CHECK-NEXT: Branch [[nullishTest]] -> taken [[nullishRight]](| 0), notTaken [[nullishKept]](| 0)
// CHECK-NOT: = ToBoolean
// CHECK-NOT: Jump {{*}}([[a]])
// CHECK: [[nullishKept]]([[present]]):
// CHECK-NEXT: Jump -> next [[nullishJoin]]([[present]])
// CHECK-NOT: = ToBoolean
// CHECK-NOT: Jump {{*}}([[a]])
// CHECK-LABEL: function {{*}}name="or"
// CHECK: [[orTest]] = ToBoolean [[a]]
// CHECK-NEXT: Branch [[orTest]] -> taken [[orKept]](| 0), notTaken [[orRight]](| 0)
// CHECK-NOT: Jump {{*}}([[a]])
// CHECK: [[orKept]]([[truthy]]):
// CHECK-NEXT: Jump -> next [[orJoin]]([[truthy]])
// CHECK-NOT: Jump {{*}}([[a]])

// RUN(RIGHT): lower
// RIGHT-LABEL: function {{*}}name="and"
// RIGHT: b0([[a]]: anything, [[b]]: anything):
// RIGHT: Jump -> next [[andJoin]]([[b]])
// RIGHT: [[andJoin]]([[andValue]]):
// RIGHT-NEXT: Return [[andValue]]
// RIGHT-LABEL: function {{*}}name="nullish"
// RIGHT: Jump -> next [[nullishJoin]]([[b]])
// RIGHT: [[nullishJoin]]([[nullishValue]]):
// RIGHT-NEXT: Return [[nullishValue]]
// RIGHT-LABEL: function {{*}}name="or"
// RIGHT: Jump -> next [[orJoin]]([[b]])
// RIGHT: [[orJoin]]([[orValue]]):
// RIGHT-NEXT: Return [[orValue]]

export function and(a: any, b: any): any {
  return a && b;
}

export function nullish(a: any, b: any): any {
  return a ?? b;
}

export function or(a: any, b: any): any {
  return a || b;
}
