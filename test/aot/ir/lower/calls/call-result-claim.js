// RUN: lower
// CHECK-LABEL: function {{*}}name="anyResult"
// CHECK-NOT: site=
// CHECK: [[untypedResult]] = Call {{*}}calleeName="untyped"
// CHECK-NEXT: Return [[untypedResult]]
// CHECK-LABEL: function {{*}}name="writtenResult"
// CHECK-NOT: site=
// CHECK: [[result]] = Call {{*}}calleeName="parse"
// CHECK-NEXT: [[convertedResult]] = Convert [[result]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: = PropGet [[convertedResult]] key="port"
// CHECK-NOT: site=

export function anyResult(untyped) {
  const n = untyped();
  return n;
}

export function writtenResult(parse, text) {
  return parse(text).port;
}
