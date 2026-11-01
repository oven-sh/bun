// RUN: lower
// OPTIONS: type-errors=log
// CHECK-LABEL: function {{*}}name="f"
// CHECK: thisType={type=undefined|null|string site=w{{*}}}

// RUN(SITES): link
// SITES: typesite {{*}}module=[[entry]] position=259 kind=This text="string"

export function f(this: string, a: number) {
  return a;
}
