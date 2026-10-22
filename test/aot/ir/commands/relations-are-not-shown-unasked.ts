// RUN: lower
// CHECK-NOT: relations=
// CHECK: name="identity"
// CHECK-NOT: relations=

export function identity(x: unknown) {
  return x;
}
