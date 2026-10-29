// RUN: lower
// CHECK-LABEL: function {{*}}name="narrow"
// CHECK: ([[value]]: anything):
// CHECK: [[cast]] = Convert [[value]] declared={type=undefined|null|string site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: Return [[cast]]

export function narrow(value: unknown): string {
  return value as string;
}

export const text = narrow("a");
