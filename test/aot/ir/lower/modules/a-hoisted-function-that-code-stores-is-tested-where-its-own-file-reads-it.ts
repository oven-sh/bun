// The variable of a hoisted function that captures is filled by code, so its type has `absent`. A read in its own file gets the test that a read in another file has:
// a value that may be absent goes into no call, no capture and no store.
// OPTIONS: entry-points-run-again

// RUN: lower
// CHECK-LABEL: function {{*}}name="reads"
// CHECK: [[read]] = GetModuleVariable
// CHECK-NEXT: = CheckInitialized [[read]] name="holds"

const kept = new Map<string, string>();
export function holds(name: string): string | undefined {
  return kept.get(name);
}
export function reads(given?: typeof holds) {
  return given ?? holds;
}
