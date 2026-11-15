// RUN: lower
// CHECK-LABEL: function {{*}}name="clear"
// CHECK-NOT: Convert
// CHECK: [[nothing]] = Undefined
// CHECK-NEXT: PropSet {{*}}, [[nothing]] key="size"
// CHECK-NOT: Convert
// CHECK-LABEL: function {{*}}name="force"
// CHECK: b0({{*}}, [[value]]: anything):
// CHECK-NOT: Convert
// CHECK: PropSet {{*}}, [[value]] key="size"
// CHECK-NOT: Convert

// RUN(LAYOUT): link
// LAYOUT: layout {{*}}fields=[{key="size" declared={type=undefined|number}

// `size?: number` is written `number`, and the member takes `undefined` too: the field of the layout lists it. The layout says what the field is declared to hold,
// so no store says it again.
interface Box {
  size?: number;
}

export function clear(box: Box): void {
  box.size = undefined;
}

export function force(box: Box, value: any): void {
  box.size = value;
}
