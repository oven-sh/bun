// RUN: lower
// CHECK-LABEL: function {{*}}name="keys"
// CHECK: [[enumerator]] = ForInOpen [[object]]
// CHECK: LoopHint
// CHECK-NEXT: [[step]] = ForInStep [[enumerator]], [[object]]
// CHECK-NEXT: [[done]] = ResultAt [[step]]
// CHECK-NEXT: [[key]] = ResultAt [[step]] index=1
// CHECK-NEXT: Branch [[done]] -> taken [[after]]({{*}}), notTaken [[body]]({{*}})
// CHECK: = ElemGet [[object]],

// RUN(PLAIN): lower
// PLAIN-NOT: handler=
// PLAIN-NOT: IteratorOpen
// PLAIN-NOT: IteratorClose

export function keys(object, use) {
  for (const key in object) {
    if (use(object[key])) break;
  }
}
