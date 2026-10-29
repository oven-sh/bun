// RUN: lower
// CHECK-LABEL: function {{*}}name="deadBreak"
// CHECK: Switch {{*}}cases=[0] ->
// CHECK-LABEL: function {{*}}name="deadReturn"
// CHECK-NOT: integer=2
// CHECK: Switch {{*}}cases=[0] ->
// CHECK-NOT: integer=2

declare function cleanup(): void;

export function deadBreak() {
  for (;;) {
    try {
      return 1;
      break;
    } finally {
      cleanup();
    }
  }
}

export function deadReturn() {
  try {
    return 1;
    return 2;
  } finally {
    cleanup();
  }
}
