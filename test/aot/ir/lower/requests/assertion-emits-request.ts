// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[cast]] = Convert {{*}}declared={type=undefined|null|string flags={{*}}} illTypedCause=Assertion
// CHECK-NEXT: Return [[cast]]

// RUN(SITES): link
// SITES: function {{*}}name="f"
// SITES: = Convert {{*}}declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}

export function f(x: any) {
  return x as string;
}
