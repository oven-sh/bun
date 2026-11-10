// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: Convert
// CHECK: [[call]] = Call
// CHECK-NOT: Convert
// CHECK: Return [[call]]
// CHECK-LABEL: function {{*}}name="g"
// CHECK: results=[{type=anything}]
// CHECK-NOT: Convert

// A result without an annotation is untyped: nothing is converted where `g` returns, nor where `f` calls it.
function g() {
  return 1;
}

export function f() {
  const v = g();
  g();
  return v;
}
