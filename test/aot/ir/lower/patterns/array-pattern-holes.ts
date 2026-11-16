// RUN: lower
// CHECK-LABEL: function {{*}}name="leading"
// CHECK: = IteratorOpen {{*}}elementCount=2 [isDestructuring]
// CHECK-COUNT-2: = IteratorResume
// CHECK-NOT: = IteratorResume
// CHECK-LABEL: function {{*}}name="middle"
// CHECK: = IteratorOpen {{*}}elementCount=3 [isDestructuring]
// CHECK-COUNT-3: = IteratorResume
// CHECK-NOT: = IteratorResume

// RUN(STORES): lower
// STORES-LABEL: function {{*}}name="leading"
// STORES-COUNT-1: PutModuleVariable
// STORES-NOT: PutModuleVariable
// STORES-LABEL: function {{*}}name="middle"
// STORES-COUNT-2: PutModuleVariable
// STORES-NOT: PutModuleVariable

export let a: any;
export let b: any;

export function leading(v: any) {
  [, a] = v;
}

export function middle(v: any) {
  [a, , b] = v;
}
