// RUN: lower
// CHECK-LABEL: function {{*}}name="deadZone"
// CHECK: CheckInitialized
// CHECK: = IteratorOpen
// CHECK-LABEL: function {{*}}name="freshBinding"
// CHECK: LoopHint
// CHECK: = IteratorResume
// CHECK: = NewObject
// CHECK: = NewClosure
// CHECK-LABEL: function {{*}}name="memberTarget"
// CHECK-NOT: = Call
// CHECK: = IteratorResume
// CHECK: = Call
// CHECK: PropSet {{*}}key="b"

export function deadZone() {
  for (let x of x) {
  }
}

export function freshBinding(list, items) {
  for (let item of items) list.push(() => item++);
}

export function memberTarget(items, target) {
  for (target().b of items) {
  }
}
