// RUN: lower
// CHECK-LABEL: function {{*}}name="visit"
// CHECK: = IteratorOpen {{*}}@[[statement]]
// CHECK: = IteratorResume {{*}}@[[statement]]

// RUN(CLOSES): lower
// CLOSES: = IteratorOpen {{*}}@[[statement]]
// CLOSES-COUNT-2: IteratorClose {{*}}@[[statement]]

// RUN(SUBJECT): lower
// SUBJECT: = Call {{*}}@[[call]]
// SUBJECT-NOT: = IteratorOpen {{*}}@[[call]]
// SUBJECT: = IteratorResume

export function visit(items, use) {
  for (const item of use(items)) if (use(item)) break;
}
