// RUN: lower
// CHECK-LABEL: function {{*}}name="nested"
// CHECK: [[outer]] = IteratorOpen {{*}}elementCount=1 [isDestructuring, hasRest]
// CHECK: [[collected]] = NewArray
// CHECK: [[inner]] = IteratorOpen [[collected]] elementCount=2 [isDestructuring] @
// CHECK: = IteratorResume [[inner]] stepIndex=0
// CHECK: = IteratorResume [[inner]] stepIndex=1
// CHECK-LABEL: function {{*}}name="onlyRest"
// CHECK: [[only]] = IteratorOpen {{*}}elementCount=0 [isDestructuring, hasRest]
// CHECK: [[all]] = NewArray
// CHECK: LoopHint
// CHECK-NEXT: [[onlyStep]] = IteratorResume [[only]] stepIndex=0
// CHECK: [[onlyValue]] = ResultAt [[onlyStep]] index=1
// CHECK: AppendElement [[all]], [[onlyValue]]
// CHECK-LABEL: function {{*}}name="rest"
// CHECK: [[iterator]] = IteratorOpen {{*}}elementCount=1 [isDestructuring, hasRest]
// CHECK: = IteratorResume [[iterator]] stepIndex=0
// CHECK: [[rest]] = NewArray
// CHECK: LoopHint
// CHECK-NEXT: [[step]] = IteratorResume [[iterator]] stepIndex=1
// CHECK-NEXT: [[done]] = ResultAt [[step]]
// CHECK-NEXT: [[value]] = ResultAt [[step]] index=1
// CHECK-NEXT: Branch [[done]] -> taken [[exit]](), notTaken [[append]]()
// CHECK: [[append]]()
// CHECK-NEXT: AppendElement [[rest]], [[value]]

// RUN(STEPS): lower
// STEPS-LABEL: function {{*}}name="rest"
// STEPS-COUNT-2: = IteratorResume
// STEPS-NOT: = IteratorResume

export function nested(v: any) {
  const [a, ...[b, c]] = v;
  return a + b + c;
}

export function onlyRest(v: any) {
  let all: any;
  [...all] = v;
  return all;
}

export function rest(v: any) {
  const [a, ...rest] = v;
  return [a, rest];
}
