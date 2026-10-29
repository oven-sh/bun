// RUN: lower
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK: [[conditionalTest]] = ToBoolean [[c]]
// CHECK-NEXT: Branch [[conditionalTest]] -> taken [[truthy]](| 0), notTaken {{*}}(| 0)
// CHECK: [[truthy]]([[object]]):
// CHECK: [[convertedObject]] = Convert [[object]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK: = PropGet [[convertedObject]] key="a"
// CHECK-LABEL: function {{*}}name="loop"
// CHECK: [[header]]([[node]]):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: [[loopTest]] = ToBoolean [[node]]
// CHECK-NEXT: Branch [[loopTest]] -> taken [[body]](| 0), notTaken {{*}}(| 0)
// CHECK: [[body]]([[current]]):
// CHECK: [[convertedCurrent]] = Convert [[current]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK: [[next]] = PropGet [[convertedCurrent]] key="next"
// CHECK: Jump -> next [[header]]([[next]])
// CHECK-LABEL: function {{*}}name="statement"
// CHECK: [[test]] = ToBoolean [[x]]
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken {{*}}(| 0)
// CHECK-NOT: Return [[x]]
// CHECK: [[taken]]([[truthyValue]]):
// CHECK-NOT: Return [[x]]
// CHECK: Return [[truthyValue]]
// CHECK-NOT: Return [[x]]

// RUN(OTHER): lower
// OTHER-LABEL: function {{*}}name="loop"
// OTHER: Branch {{*}}notTaken [[exit]](| 0)
// OTHER: [[exit]]([[last]]):
// OTHER: Return [[last]]
// OTHER-LABEL: function {{*}}name="statement"
// OTHER: Branch {{*}}notTaken [[other]](| 0)
// OTHER: [[other]]([[falsyValue]]):
// OTHER: Return [[falsyValue]]

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
