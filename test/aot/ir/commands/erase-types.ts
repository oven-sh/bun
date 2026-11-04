// RUN: lower
// OPTIONS: erase-types
// CHECK-NOT: site=
// CHECK-NOT: illTypedCause=
// CHECK-LABEL: function {{*}}name="narrow"
// CHECK-NOT: site=
// CHECK: results=[{type=undefined|null|string flags=[IsExpected]}]
// CHECK: ([[value]]: anything):
// CHECK: = Convert [[value]] declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NOT: site=
// CHECK-NOT: illTypedCause=

// RUN(ROLE): lower
// ROLE-NOT: IsChecked

export function narrow(value: unknown): string {
  return value as string;
}

export const text = narrow("a");
