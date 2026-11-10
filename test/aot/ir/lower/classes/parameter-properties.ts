// RUN: lower
// CHECK-LABEL: function {{*}}name="Base" {{*}}kind=BaseConstructor
// CHECK: [[allocated]] = NewObject {{*}}layout=[[layout]] @
// CHECK-NEXT: [[this]] = Convert [[allocated]] declared={type=[[layout]]}
// CHECK-NOT: PropDefine
// CHECK: = Call {{*}}calleeName="initial"
// CHECK: PropDefine [[this]], {{*}}key="a"
// CHECK: PropDefine [[this]], {{*}}key="b"
// CHECK-NOT: key="c"
// CHECK-LABEL: function {{*}}name="Derived" {{*}}kind=DerivedConstructor
// CHECK-NOT: PropSet
// CHECK: [[derived]] = SuperConstruct
// CHECK: [[convertedDerived]] = Convert [[derived]] declared={type=L{{*}}} @
// CHECK: PropSet [[convertedDerived]], {{*}}key="d"

// RUN(FIELDS): lower
// FIELDS-LABEL: function {{*}}kind=Initializer
// FIELDS: [[first]] = Undefined
// FIELDS-NEXT: PropDefine [[self]], [[first]] key="d"

declare function initial(): number;

export class Base {
  constructor(
    public a: number,
    private b = initial(),
    c: number,
  ) {}
}

export class Derived extends Base {
  constructor(public d: number) {
    super(d, 1, 2);
  }
}
