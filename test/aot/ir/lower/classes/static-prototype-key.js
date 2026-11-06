// RUN: lower
// CHECK-LABEL: function {{*}}name="fixed"
// CHECK-NOT: StrictEq
// CHECK-NOT: Branch
// CHECK: [[error]] = NewRuntimeError runtimeError=StaticPrototypeKey
// CHECK-NEXT: Throw [[error]]
// CHECK-LABEL: function {{*}}name="unknown"
// CHECK: [[key]] = ToPropertyKey
// CHECK: [[isPrototype]] = StrictEq [[key]],
// CHECK: Branch [[isPrototype]] -> taken [[invalid]](), notTaken [[valid]]()
// CHECK: [[invalid]]() frequency=Unlikely:
// CHECK-NEXT: = NewRuntimeError runtimeError=StaticPrototypeKey
// CHECK: [[valid]]():
// CHECK: = FinishClass

export function fixed() {
  return class {
    static ["prototype"] = 1;
  };
}

export function unknown(k) {
  return class {
    static [k] = 1;
  };
}
