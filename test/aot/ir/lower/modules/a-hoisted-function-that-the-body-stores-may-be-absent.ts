// A module that runs again holds what it does not export in an environment of the run, which its body makes. A hoisted function that names any of that captures the environment, so its closure
// is made where the body begins, and not when the graph is linked. In a ring the body of an importer runs first and finds nothing in the variable: the type says so, and the importer's test stays.
// OPTIONS: entry-points-run-again

// RUN: link
// CHECK: variable {{*}}name="free" {{*}}initialization=Function function=
// CHECK: variable {{*}}name="holds" {{*}}declared={type={{*}}absent
// CHECK-NOT: initialization=Function
// CHECK: module

const kept = new Map<string, string>();
export function holds(name: string): string | undefined {
  return kept.get(name);
}
export function free(name: string): string {
  return name;
}
