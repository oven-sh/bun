// RUN: lower
// CHECK-LABEL: function {{*}}name="C" {{*}}kind=BaseConstructor flags=[HasNewTarget,
// CHECK: b0([[newTarget]]: anything, [[a]]: number):
// CHECK: [[prototype]] = GetConstructPrototype [[newTarget]] layout=[[layout]]
// CHECK-NEXT: [[allocated]] = NewObject [[prototype]] layout=[[layout]] @
// CHECK-NEXT: [[this]] = Convert [[allocated]] declared={type=[[layout]]}
// CHECK: PropSet [[this]], [[a]] key="a"

// RUN(CLOSE): lower
// CLOSE-NOT: FinishObject

export class C {
  a: number;
  constructor(a: number) {
    this.a = a;
  }
}
