// RUN: lower
// CHECK-LABEL: function {{*}}name="AfterSuper"{{*}}kind=DerivedConstructor
// CHECK: [[object]] = SuperConstruct
// CHECK-NEXT: [[instance]] = Convert [[object]] declared={type=L{{*}}} @
// CHECK-NOT: TypeTest
// CHECK-NOT: NewRuntimeError
// CHECK: Return [[instance]]
// CHECK-NOT: TypeTest
// CHECK-NOT: NewRuntimeError
// CHECK-LABEL: function {{*}}name="WithoutSuper"{{*}}kind=DerivedConstructor
// CHECK: [[neverBound]] = Absent
// CHECK: [[isNeverBound]] = TypeTest [[neverBound]] testedType=absent
// CHECK-NEXT: Branch [[isNeverBound]] -> taken [[thrown]](| 0), notTaken [[unreached]](| 0)
// CHECK: [[thrown]]([[thrownProof]]):
// CHECK-NEXT: [[thrownError]] = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw [[thrownError]]
// CHECK-NOT: ThisAlreadyBound

class Base {}

export class AfterSuper extends Base {
  x: number;
  constructor() {
    super();
    this.x = 1;
  }
}

export class WithoutSuper extends null {
  x: number;
  constructor() {
    this.x = 1;
  }
}
