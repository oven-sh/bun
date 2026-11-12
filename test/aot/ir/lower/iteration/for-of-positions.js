// RUN: lower
// CHECK-LABEL: function {{*}}name="visit"
// CHECK: = IteratorOpen {{*}}@[[variable]]
// CHECK: = IteratorResume {{*}}@[[variable]]

// RUN(CLOSES): lower
// CLOSES: = IteratorOpen {{*}}@[[variable]]
// CLOSES-COUNT-2: IteratorClose {{*}}@[[variable]]

// RUN(SUBJECT): lower
// SUBJECT: = Call {{*}}@[[call]]
// SUBJECT-NOT: = IteratorOpen {{*}}@[[call]]
// SUBJECT: = IteratorResume

export function visit(items, use) {
  for (const item of use(items)) if (use(item)) break;
}
