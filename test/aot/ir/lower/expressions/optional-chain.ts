// RUN: lower
// CHECK-LABEL: function {{*}}name="nonNull"
// CHECK-COUNT-1: = TypeTest
// CHECK-NOT: = TypeTest
// CHECK: = Undefined
// CHECK-NOT: = TypeTest
// CHECK-NOT: = Undefined
// CHECK-LABEL: function {{*}}name="oneExit"
// CHECK-COUNT-1: = TypeTest
// CHECK-NOT: = TypeTest
// CHECK: = Undefined
// CHECK-NOT: = TypeTest
// CHECK-NOT: = Undefined
// CHECK-LABEL: function {{*}}name="parenthesized"
// CHECK: [[skipped]] = Undefined
// CHECK-NEXT: Jump -> next [[join]]([[skipped]])
// CHECK: [[join]]([[value]]):
// CHECK-NEXT: = PropGet [[value]] key="c"
// CHECK-LABEL: function {{*}}name="twoLinks"
// CHECK-COUNT-2: = TypeTest
// CHECK-NOT: = TypeTest
// CHECK: = Undefined
// CHECK-NOT: = TypeTest
// CHECK-NOT: = Undefined

// RUN(READS): lower
// READS-LABEL: function {{*}}name="nonNull"
// READS: [[nonNullLink]] = PropGet {{*}}key="b"
// READS-NEXT: = PropGet [[nonNullLink]] key="c"
// READS-LABEL: function {{*}}name="oneExit"
// READS: [[oneExitLink]] = PropGet {{*}}key="b"
// READS-NEXT: = PropGet [[oneExitLink]] key="c"

export function nonNull(a: any) {
  return a?.b!.c;
}

export function oneExit(a: any) {
  return a?.b.c;
}

export function parenthesized(a: any) {
  return (a?.b).c;
}

export function twoLinks(a: any) {
  return a?.b?.c;
}
