// RUN: lower
// CHECK-LABEL: function {{*}}name="onlyThrows"
// CHECK: [[landing]]() role=CleanupHandler:
// CHECK-NEXT: [[caught]] = CatchValue
// CHECK: key="cleanup"
// CHECK: Throw [[caught]]

// RUN(PATHS): lower
// PATHS-NOT: Switch

declare function call(): number;
declare function cleanup(): void;

export function onlyThrows() {
  try {
    throw call();
  } finally {
    cleanup();
  }
}
