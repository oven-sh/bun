// RUN: lower
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK: [[conditionalTest]] = ToBoolean [[c]]
// CHECK-NEXT: Branch [[conditionalTest]] -> taken [[truthy]](| 0), notTaken {{*}}(| 0)
// CHECK: [[truthy]]([[truth]]):
// CHECK-NEXT: [[narrowed]] = NarrowByTest [[c]], [[truth]] @
// CHECK-NEXT: = PropGet [[narrowed]] key="a"
// CHECK-LABEL: function {{*}}name="loop"
// CHECK: [[header]]([[node]]):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: [[loopTest]] = ToBoolean [[node]]
// CHECK-NEXT: Branch [[loopTest]] -> taken [[body]](| 0), notTaken {{*}}(| 0)
// CHECK: [[body]]([[bodyTruth]]):
// CHECK-NEXT: [[held]] = NarrowByTest [[node]], [[bodyTruth]] @
// CHECK-NEXT: [[next]] = PropGet [[held]] key="next"
// CHECK: Jump -> next [[header]]([[next]])
// CHECK-LABEL: function {{*}}name="statement"
// CHECK: [[test]] = ToBoolean [[x]]
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[taken]]([[takenTruth]]):
// CHECK-NEXT: [[returned]] = NarrowByTest [[x]], [[takenTruth]] @
// CHECK-NEXT: Return [[returned]]

// RUN(OTHER): lower
// OTHER-LABEL: function {{*}}name="loop"
// OTHER: = ToBoolean [[node]]
// OTHER: Branch {{*}}notTaken [[exit]](| 0)
// OTHER: [[exit]]({{*}}):
// OTHER-NEXT: Return [[node]]
// OTHER-LABEL: function {{*}}name="statement"
// OTHER: = ToBoolean [[x]]
// OTHER: Branch {{*}}notTaken [[other]](| 0)
// OTHER: [[other]]({{*}}):
// OTHER-NEXT: Return [[x]]

export function conditional(x: any): any {
  return x ? x.a : 0;
}

export function loop(node: any): any {
  while (node) node = node.next;
  return node;
}

export function statement(x: any): any {
  if (x) return x;
  return x;
}
