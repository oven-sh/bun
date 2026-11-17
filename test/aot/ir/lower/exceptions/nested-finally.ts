// RUN: lower
// CHECK-LABEL: function {{*}}name="nested"
// CHECK: key="call"
// CHECK: [[inner]]([[selector]], [[returned]], [[thrown]]) handler=[[outer]]():
// CHECK: key="cleanup"
// CHECK: [[outer]]() role=CleanupHandler:
// CHECK: key="after"
// CHECK: Return

// RUN(ORDER): lower
// ORDER-LABEL: function {{*}}name="nested"
// ORDER-NOT: Return [[early]]
// ORDER: key="after"

// RUN(COPIES): lower
// COPIES: key="call"
// COPIES-NOT: key="call"
// COPIES: key="cleanup"
// COPIES-NOT: key="call"
// COPIES-NOT: key="cleanup"
// COPIES: key="after"
// COPIES-NOT: key="call"
// COPIES-NOT: key="cleanup"
// COPIES-NOT: key="after"

declare function call(): number;
declare function cleanup(): void;
declare function after(): void;

export function nested() {
  try {
    try {
      return call();
    } finally {
      cleanup();
    }
  } finally {
    after();
  }
}
