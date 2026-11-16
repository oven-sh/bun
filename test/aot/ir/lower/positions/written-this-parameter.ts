// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: thisType={type=undefined|null|string flags={{*}}}


export function f(this: string, a: number) {
  return a;
}
