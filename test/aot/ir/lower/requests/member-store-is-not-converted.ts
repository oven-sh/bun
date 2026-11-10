// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[p]]: {{*}}, [[v]]: anything):
// CHECK-NOT: Convert
// CHECK: PropSet [[p]], [[v]] key="x"
// CHECK-NOT: Convert

// RUN(LAYOUT): link
// LAYOUT: layout [[record]] {{*}}fields=[{key="x" declared={type=number} flags=[IsRequired]}]
// LAYOUT: function {{*}}name="f" {{*}}parameters=[{type=undefined|null|[[record]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}]
// LAYOUT-NOT: Convert
// LAYOUT: PropSet {{*}}key="x"

// The layout says what the field is declared to hold, so the store does not say it again.
export function f(p: { x: number }, v: any) {
  p.x = v;
}
