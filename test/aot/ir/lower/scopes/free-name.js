// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[global]] = Builtin builtin=GlobalThis
// CHECK-NEXT: = PropGet [[global]] key="q" [isFreeName, isForTypeOf]
// CHECK: [[globalAgain]] = Builtin builtin=GlobalThis
// CHECK-NEXT: = PropGet [[globalAgain]] key="q" [isFreeName]

export function f() {
  return typeof q === "undefined" ? 0 : q;
}
