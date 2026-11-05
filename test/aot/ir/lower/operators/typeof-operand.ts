// RUN: lower
// CHECK-LABEL: function {{*}}name="builtin"
// CHECK: = PropGet {{*}}key="console" [isFreeName, isForTypeOf]
// CHECK: = TypeOf
// CHECK-LABEL: function {{*}}name="cast"
// CHECK: = PropGet {{*}}key="missing" [isFreeName, isForTypeOf]
// CHECK: = TypeOf
// CHECK-LABEL: function {{*}}name="free"
// CHECK: = PropGet {{*}}key="missing" [isFreeName, isForTypeOf]
// CHECK: = TypeOf
// CHECK-LABEL: function {{*}}name="local"
// CHECK-NOT: PropGet
// CHECK: ([[x]]: anything):
// CHECK-NOT: PropGet
// CHECK: = TypeOf [[x]]
// CHECK-LABEL: function {{*}}name="locked"
// CHECK-NOT: PropGet
// CHECK-NOT: = TypeOf
// CHECK: = String string="function"
// CHECK-NOT: PropGet
// CHECK-NOT: = TypeOf
// CHECK-LABEL: function {{*}}name="member"
// CHECK-NOT: isForTypeOf
// CHECK: [[read]] = PropGet {{*}}key="missing" [isFreeName]
// CHECK-NEXT: [[holder]] = Convert [[read]] declared={type={{*}}flags=[IsExpected]}
// CHECK-NEXT: [[property]] = PropGet [[holder]] key="p"
// CHECK-NOT: isForTypeOf
// CHECK: = TypeOf [[property]]

declare const missing: any;

export function builtin() {
  return typeof console;
}

export function cast() {
  return typeof (missing as any);
}

export function free() {
  return typeof missing;
}

export function local(x: any) {
  return typeof x;
}

export function locked() {
  return typeof Symbol;
}

export function member() {
  return typeof missing.p;
}
