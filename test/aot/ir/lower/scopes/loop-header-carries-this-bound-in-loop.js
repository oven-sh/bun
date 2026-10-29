// RUN: lower
// CHECK-LABEL: function {{*}}kind=DerivedConstructor
// CHECK: [[absent]] = Absent
// CHECK: Jump -> next [[header]]([[absent]])
// CHECK-NEXT: [[header]]([[this]]: absent|L{{*}}):
// CHECK-NEXT: LoopHint
// CHECK: [[constructed]] = SuperConstruct
// CHECK-NEXT: [[instance]] = Convert [[constructed]] declared={type=L{{*}} flags=[IsFromCompiler]}
// CHECK: = TypeTest [[this]] testedType=absent
// CHECK: Jump -> next [[header]]([[instance]])

class A {}

export class B extends A {
  constructor(more) {
    while (more()) super();
  }
}
