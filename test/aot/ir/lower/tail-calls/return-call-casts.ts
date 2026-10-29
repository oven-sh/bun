// RUN: lower
// CHECK-LABEL: function {{*}}name="typed"
// CHECK: results=[{type=undefined|null|number|string site=[[result]] flags=[OmitsNull, OmitsUndefined]}]
// CHECK: [[typedCall]] = Call
// CHECK-NEXT: ReturnCall [[typedCall]] casts=[{declared={type=number site=[[assertion]]}}, {declared={type=undefined|null|number|string site=[[result]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-LABEL: function {{*}}name="untyped"
// CHECK-NOT: casts=
// CHECK: [[untypedCall]] = Call
// CHECK-NEXT: ReturnCall [[untypedCall]] @

declare function call2(n: number): unknown;

export function typed(): number | string {
  return call2(1) as number;
}

export function untyped() {
  return call2(1);
}
