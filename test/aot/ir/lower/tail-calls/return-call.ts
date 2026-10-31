// RUN: lower
// CHECK-LABEL: function {{*}}name="declaration"
// CHECK-NOT: Return [[declarationValue]]
// CHECK: [[declarationCall]] = Call
// CHECK-NEXT: ReturnCall [[declarationCall]]
// CHECK-NOT: Return [[declarationValue]]
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK-NOT: Return [[arrowValue]]
// CHECK: [[arrowCall]] = Call
// CHECK-NEXT: ReturnCall [[arrowCall]]
// CHECK-NOT: Return [[arrowValue]]

declare function call2(n: number): unknown;

export function declaration(n: number) {
  return call2(n);
}

export const arrow = (n: number) => call2(n);
