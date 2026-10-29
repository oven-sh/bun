// RUN: lower
// CHECK-LABEL: function {{*}}name="breaks"
// CHECK: [[covered]]() handler=[[handler]]():
// CHECK-NEXT: Jump -> next [[after]]()
// CHECK: [[after]]():
// CHECK: key="after"

// RUN(PATHS): lower
// PATHS-NOT: Switch

declare function use(value: unknown): void;
declare function after(): void;

export function breaks() {
  for (;;) {
    try {
      break;
    } catch {
      use(1);
    }
  }
  after();
}
