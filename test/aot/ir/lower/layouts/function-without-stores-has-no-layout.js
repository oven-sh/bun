// RUN: link
// CHECK: function {{*}}name="f"

// RUN(LAYOUT): link
// LAYOUT-NOT: layout {{*}}name="f"

export function f() {
  return 1;
}
