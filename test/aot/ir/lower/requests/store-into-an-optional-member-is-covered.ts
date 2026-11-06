// RUN: lower
// CHECK-LABEL: function {{*}}name="clear"
// CHECK: [[nothing]] = Undefined
// CHECK: [[cleared]] = Convert [[nothing]] declared={type=undefined|number site=w{{*}}} @
// CHECK-NEXT: PropSet {{*}}, [[cleared]] key="size"
// CHECK-LABEL: function {{*}}name="force"
// CHECK: [[forced]] = Convert {{*}}declared={type=undefined|number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet {{*}}, [[forced]] key="size"

// `size?: number` is written `number`, and the member takes `undefined` too: the checker has accepted the store.
interface Box {
  size?: number;
}

export function clear(box: Box): void {
  box.size = undefined;
}

export function force(box: Box, value: any): void {
  box.size = value;
}
