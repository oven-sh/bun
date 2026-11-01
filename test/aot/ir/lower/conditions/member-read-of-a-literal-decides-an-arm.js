// RUN: lower
// CHECK-LABEL: function {{*}}name="item"
// CHECK: = Call {{*}}calleeName="f"
// CHECK: = ElemGet
// CHECK-NOT: calleeName="dead"
// CHECK: = Call {{*}}calleeName="live"
// CHECK-NOT: calleeName="dead"
// CHECK-LABEL: function {{*}}name="length"
// CHECK: = PropGet {{*}}key="length"
// CHECK-NOT: calleeName="dead"
// CHECK: = Call {{*}}calleeName="live"
// CHECK-NOT: calleeName="dead"
// CHECK-LABEL: function {{*}}name="property"
// CHECK: = Call {{*}}calleeName="f"
// CHECK: = PropGet {{*}}key="k"
// CHECK-NOT: calleeName="dead"
// CHECK: = Call {{*}}calleeName="live"
// CHECK-NOT: calleeName="dead"

// `bun run` has the member in place of each of these reads, so it never runs `dead`. A build evaluates the read as it is written.
export function item(f, dead, live) {
  if ([void f()][0]) dead();
  else live();
}

export function length(dead, live) {
  if ("ab".length === 3) dead();
  else live();
}

export function property(f, dead, live) {
  if ({ k: (f(), 0) }.k) dead();
  else live();
}
