// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[exported]] = IteratorOpen {{*}}elementCount=2 [isDestructuring]
// CHECK: = IteratorResume [[exported]] stepIndex=0
// CHECK: = IteratorResume [[exported]] stepIndex=1
// CHECK: IteratorClose [[exported]]
// CHECK-LABEL: function {{*}}name="captured"
// CHECK: [[captured]] = IteratorOpen {{*}}elementCount=2 [isDestructuring]
// CHECK: = IteratorResume [[captured]] stepIndex=0
// CHECK: = IteratorResume [[captured]] stepIndex=1
// CHECK: IteratorClose [[captured]]
// CHECK-LABEL: function {{*}}name="defaulted"
// CHECK: [[defaulted]] = IteratorOpen {{*}}elementCount=2 [isDestructuring]
// CHECK: = IteratorResume [[defaulted]] stepIndex=0
// CHECK: = IteratorResume [[defaulted]] stepIndex=1
// CHECK: IteratorClose [[defaulted]]
// CHECK-LABEL: function {{*}}name="guarded"
// CHECK: [[guarded]] = IteratorOpen {{*}}elementCount=2 [isDestructuring]
// CHECK: = IteratorResume [[guarded]] stepIndex=0
// CHECK: = IteratorResume [[guarded]] stepIndex=1
// CHECK: IteratorClose [[guarded]]
// CHECK-LABEL: function {{*}}name="members"
// CHECK: [[members]] = IteratorOpen {{*}}elementCount=2 [isDestructuring]
// CHECK: = IteratorResume [[members]] stepIndex=0
// CHECK: = IteratorResume [[members]] stepIndex=1
// CHECK: IteratorClose [[members]]
// CHECK-LABEL: function {{*}}name="nested"
// CHECK: [[nested]] = IteratorOpen {{*}}elementCount=2 [isDestructuring]
// CHECK: = IteratorResume [[nested]] stepIndex=0
// CHECK: = IteratorResume [[nested]] stepIndex=1
// CHECK: IteratorClose [[nested]]
// CHECK-LABEL: function {{*}}name="plain"
// CHECK: [[plain]] = IteratorOpen {{*}}elementCount=2 [isDestructuring]
// CHECK: = IteratorResume [[plain]] stepIndex=0
// CHECK: = IteratorResume [[plain]] stepIndex=1
// CHECK: IteratorClose [[plain]]

// RUN(OPENS): lower
// OPENS-COUNT-7: = IteratorOpen
// OPENS-NOT: = IteratorOpen

// RUN(STEPS): lower
// STEPS-COUNT-14: = IteratorResume
// STEPS-NOT: = IteratorResume

// RUN(NOWHERE): lower
// NOWHERE-NOT: DestructureIterable

declare const source: any;

export const [get, set] = source;

export function captured(v: any) {
  let a: any, b: any;
  const read = () => a + b;
  [a, b] = v;
  return read;
}

export function defaulted(v: any, compute: any) {
  const [first = compute(), second] = v;
  return first + second;
}

export function guarded(v: any) {
  let a: any, b: any;
  try {
    [a, b] = v;
  } catch {}
  return a + b;
}

export function members(this: any, v: any) {
  [this.lo, this.hi] = v;
}

export function nested(v: any) {
  const [name, { type }] = v;
  return name + type;
}

export function plain(v: any) {
  const [a, b] = v;
  return a + b;
}
