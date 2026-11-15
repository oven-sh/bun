// RUN: lower
// CHECK-LABEL: function {{*}}name="descriptorOfConstants"
// CHECK-NOT: = Data
// CHECK: [[descriptorOfConstants_made]] = NewObject
// CHECK: [[descriptorOfConstants_finished]] = FinishObject [[descriptorOfConstants_made]]
// CHECK: = Call {{*}}, [[descriptorOfConstants_finished]] calleeName="Object.defineProperty"
// CHECK-LABEL: function {{*}}name="descriptorThatSomebodyHolds"
// CHECK-NOT: = NewObject
// CHECK: = Data
// CHECK-LABEL: function {{*}}name="descriptorThroughReflect"
// CHECK-NOT: = Data
// CHECK: = NewObject
// CHECK-LABEL: function {{*}}name="literalThatIsTheTarget"
// CHECK-NOT: = NewObject
// CHECK: = Data

export function descriptorOfConstants(object) {
  return Object.defineProperty(object, "x", { value: 1, enumerable: true });
}

export function descriptorThatSomebodyHolds(object) {
  const descriptor = { value: 1, enumerable: true };
  return Object.defineProperty(object, "x", descriptor);
}

export function descriptorThroughReflect(object) {
  return Reflect.defineProperty(object, "x", { value: 1, enumerable: true });
}

export function literalThatIsTheTarget(descriptor) {
  return Object.defineProperty({ value: 1, enumerable: true }, "x", descriptor);
}
