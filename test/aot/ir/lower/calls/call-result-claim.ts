// RUN: lower
// CHECK-LABEL: function {{*}}name="anyResult"
// CHECK-NOT: Convert
// CHECK: [[untypedResult]] = Call {{*}}calleeName="untyped"
// CHECK-NEXT: [[n]] = Convert [[untypedResult]] declared={type=number} @
// CHECK-NEXT: = Negate [[n]]
// CHECK-LABEL: function {{*}}name="writtenResult"
// CHECK: [[result]] = Call [[callee]], {{*}}calleeName="parse"
// CHECK-NEXT: [[config]] = Convert [[result]] declared={type=undefined|null|L{{*}}} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: = PropGet [[config]] key="port"

interface Config {
  port: number;
}

declare function parse(text: string): Config;
declare function untyped(): any;

export function anyResult() {
  const n: number = untyped();
  return -n;
}

export function writtenResult(text: string) {
  return parse(text).port;
}
