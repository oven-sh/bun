// RUN: lower
// OPTIONS: type-errors=log
// CHECK-NOT: ReportMismatch
// CHECK-LABEL: function {{*}}name="narrow"
// CHECK: [[cast]] = Convert {{*}}declared={type=undefined|null|string site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: Return [[cast]]
// CHECK-NOT: ReportMismatch

export function narrow(value: unknown): string {
  return value as string;
}

export const text = narrow("a");
