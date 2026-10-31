// RUN: lower
// CHECK-LABEL: function {{*}}name="member"
// CHECK: b0([[parameter]]: anything):
// CHECK: [[convertedParameter]] = Convert [[parameter]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[old]] = PropGet [[convertedParameter]] key="p"
// CHECK-NEXT: [[incremented]] = Increment [[old]]
// CHECK-NEXT: PropSet [[convertedParameter]], [[incremented]] key="p"
// CHECK-LABEL: function {{*}}name="memberCall"
// CHECK: [[made]] = Call {{*}}calleeName="o"
// CHECK-NEXT: [[object]] = Convert [[made]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[before]] = PropGet [[object]] key="p"
// CHECK-NEXT: [[decremented]] = Decrement [[before]]
// CHECK-NEXT: PropSet [[object]], [[decremented]] key="p"
// CHECK-NOT: calleeName="o"
// CHECK-LABEL: function {{*}}name="postfixEffect"
// CHECK-NOT: ToNumeric
// CHECK: [[bumped]] = Increment [[parameter]]
// CHECK-NEXT: Return [[bumped]]
// CHECK-LABEL: function {{*}}name="postfixValue"
// CHECK: [[numeric]] = ToNumeric [[parameter]]
// CHECK-NEXT: = Increment [[numeric]]
// CHECK-NEXT: Return [[numeric]]
// CHECK-LABEL: function {{*}}name="prefix"
// CHECK-NOT: ToNumeric
// CHECK: [[next]] = Increment [[parameter]]
// CHECK-NEXT: Return [[next]]

export function member(o: any) {
  o.p++;
}

export function memberCall(o: any) {
  o().p--;
}

export function postfixEffect(x: any): any {
  x++;
  return x;
}

export function postfixValue(x: any): any {
  return x++;
}

export function prefix(x: any): any {
  return ++x;
}
