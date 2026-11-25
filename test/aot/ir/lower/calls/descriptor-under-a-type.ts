// RUN: lower
// CHECK-LABEL: function {{*}}name="asserted"
// CHECK-NOT: = Data
// CHECK: = NewObject
// CHECK-LABEL: function {{*}}name="satisfying"
// CHECK-NOT: = Data
// CHECK: = NewObject

export function asserted(object: object) {
  return Object.defineProperty(object, "x", { value: 1, enumerable: true } as PropertyDescriptor);
}

export function satisfying(object: object) {
  return Object.defineProperty(object, "x", { value: 1, enumerable: true } satisfies PropertyDescriptor);
}
