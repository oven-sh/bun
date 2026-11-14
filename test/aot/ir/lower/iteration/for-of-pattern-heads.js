// RUN: lower
// CHECK-LABEL: function {{*}}name="arrayHead"
// CHECK: [[outer]] = IteratorOpen
// CHECK-NOT: isDestructuring
// CHECK: = IteratorResume [[outer]]
// CHECK: [[inner]] = IteratorOpen {{*}}elementCount=1{{*}}isDestructuring
// CHECK: = IteratorResume [[inner]]
// CHECK: PropSet {{*}}key="p"
// CHECK-LABEL: function {{*}}name="objectHead"
// CHECK: = IteratorResume
// CHECK: = PropGet {{*}}key="a"

export function arrayHead(items, target) {
  for ([target.p] of items) {
  }
}

export function objectHead(items, use) {
  let a;
  for ({ a } of items) use(a);
}
