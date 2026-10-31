// RUN: lower
// CHECK-LABEL: function {{*}}name="afterTry"
// CHECK: key="call"
// CHECK: ReturnCall
// CHECK-LABEL: function {{*}}name="inCatchClause"
// CHECK: role=CatchHandler
// CHECK: key="call"
// CHECK: ReturnCall
// CHECK-LABEL: function {{*}}name="inFinalizer"
// CHECK: role=CleanupHandler
// CHECK: key="call"
// CHECK: ReturnCall

declare function use(value: unknown): void;
declare function call(): number;

export function afterTry() {
  try {
    use(0);
  } catch {}
  return call();
}

export function inCatchClause() {
  try {
    use(0);
  } catch {
    return call();
  }
}

export function inFinalizer() {
  try {
  } finally {
    return call();
  }
}
