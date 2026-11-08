// RUN: lower
// OPTIONS: erase-types
// CHECK-NOT: site=
// CHECK-NOT: illTypedCause=
// CHECK-LABEL: function {{*}}name="narrow"
// CHECK-NOT: site=
// CHECK: results=[{type=anything}]
// CHECK: ([[value]]: anything):
// CHECK-NOT: Convert
// CHECK: Return [[value]]
// CHECK-NOT: site=
// CHECK-NOT: illTypedCause=

// RUN(ROLE): lower
// ROLE-NOT: IsChecked

export function narrow(value: unknown): string {
  return value as string;
}

export const text = narrow("a");
