// RUN: lower
// CHECK: function {{*}}kind=Module
// CHECK-NEXT: b0():
// CHECK: = PropGet {{*}}key="arguments" [isFreeName, isForTypeOf]
// CHECK: = PropGet {{*}}key="arguments" [isFreeName]

// RUN(KIND): lower
// KIND-NOT: Arguments

export const kind = typeof arguments;
export const read = () => arguments;
