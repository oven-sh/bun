// RUN: lower
// `{ __proto__: null }` is what Object.create(null) makes: the object is born without a prototype, and nothing has to take one away from it.
// CHECK-LABEL: function {{*}}name="map"
// CHECK-NOT: NewObject
// CHECK-NOT: SetLiteralPrototype
// CHECK: [[nothing]] = Null
// CHECK-NEXT: [[create]] = Builtin builtin=ObjectCreate
// CHECK-NEXT: = Call [[create]], -, [[nothing]]
// A literal that has a member too keeps its layout.
// CHECK-LABEL: function {{*}}name="record"
// CHECK: = NewObject
export function map() {
  return { __proto__: null };
}
export function record(x) {
  return { __proto__: null, x };
}
