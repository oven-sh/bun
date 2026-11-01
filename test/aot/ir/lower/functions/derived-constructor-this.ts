// RUN: lower
// CHECK-LABEL: function {{*}}name="AfterSuper"{{*}}kind=DerivedConstructor
// CHECK: [[unbound]] = Absent
// CHECK: [[object]] = SuperConstruct
// CHECK-NEXT: [[instance]] = Convert [[object]] declared={type=L{{*}} flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: [[isUnbound]] = TypeTest [[unbound]] testedType=absent
// CHECK-NEXT: Branch [[isUnbound]] -> taken [[bind]](| 0), notTaken [[boundTwice]](| 0)
// CHECK: [[isMissing]] = TypeTest [[instance]] testedType=absent
// CHECK-NEXT: Branch [[isMissing]] -> taken [[missing]](| 0), notTaken [[present]](| 0)
// CHECK: [[missing]]([[missingProof]]) frequency=Unlikely:
// CHECK-NEXT: [[missingError]] = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw [[missingError]]
// CHECK: [[boundTwice]]([[boundProof]]) frequency=Unlikely:
// CHECK-NEXT: [[boundError]] = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw [[boundError]]
// CHECK-LABEL: function {{*}}name="WithoutSuper"{{*}}kind=DerivedConstructor
// CHECK: [[neverBound]] = Absent
// CHECK: [[isNeverBound]] = TypeTest [[neverBound]] testedType=absent
// CHECK-NEXT: Branch [[isNeverBound]] -> taken [[thrown]](| 0), notTaken [[unreached]](| 0)
// CHECK: [[thrown]]([[thrownProof]]) frequency=Unlikely:
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
