// RUN: lower
// CHECK-LABEL: function {{*}}name="overrides"
// CHECK-NOT: Return [[early]]
// CHECK-NOT: Switch
// CHECK: integer=2
// CHECK: Return
// CHECK-NOT: Return [[late]]
// CHECK-NOT: Switch

export function overrides() {
  try {
    return 1;
  } finally {
    return 2;
  }
}
