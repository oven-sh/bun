// RUN: lower
// CHECK-LABEL: function {{*}}name="asyncFunction"
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="asyncGenerator"
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="generator"
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="plain"
// CHECK: [[call]] = Call
// CHECK-NEXT: ReturnCall [[call]]

declare function next(): number;

export async function asyncFunction() {
  return next();
}

export async function* asyncGenerator() {
  return next();
}

export function* generator() {
  return next();
}

export function plain() {
  return next();
}
