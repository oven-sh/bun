// RUN: lower
// CHECK-LABEL: function {{*}}name="visit"
// CHECK: = IteratorOpen
// CHECK: = IteratorResume

// RUN(CONVERSIONS): lower
// CONVERSIONS-NOT: Convert

export function visit(items, use) {
  for (const item of items) use(item);
}
