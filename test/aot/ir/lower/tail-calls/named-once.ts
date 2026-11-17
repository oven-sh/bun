// RUN: lower
// CHECK-LABEL: function {{*}}name="breakBehind"
// CHECK: [[breakCall]] = Call
// CHECK-NEXT: ReturnCall [[breakCall]]
// CHECK-LABEL: function {{*}}name="castsOnTheWay"
// CHECK: [[castCall]] = Call
// CHECK-NEXT: ReturnCall [[castCall]] casts=[{{*}}{declared={type=undefined|null|number|string{{*}}}}, {declared={type=number{{*}}}}, {declared={type=number{{*}}}}]
// CHECK-LABEL: function {{*}}name="inOneStatement"
// CHECK: [[statementCall]] = Call
// CHECK-NEXT: ReturnCall [[statementCall]]
// CHECK-LABEL: function {{*}}name="notTheLast"
// CHECK-NOT: ReturnCall
// CHECK: Return [[first]]
// CHECK-LABEL: function {{*}}name="returnsFunction"
// CHECK: NewClosure function=[[unnamed]]
// CHECK-LABEL: function {{*}}name="returnsFunctionOfVar"
// CHECK: NewClosure function=[[named]]
// CHECK: function [[unnamed]] module=
// CHECK: function [[named]] name="made"

declare function call(n: number): unknown;
declare function loose(n: number): any;

export function breakBehind(n: number) {
  switch (n) {
    default:
      const result = call(n);
      return result;
      break;
  }
}

export function castsOnTheWay(n: number): number {
  const first: number | string = loose(n);
  const second = first as number;
  return second;
}

export function inOneStatement(n: number) {
  const first = call(n),
    second = first;
  return second;
}

export function notTheLast(n: number) {
  const first = call(n),
    other = n;
  return first;
}

export function returnsFunction() {
  const made = function () {};
  return made;
}

export function returnsFunctionOfVar() {
  var made = function () {};
  return made;
}
