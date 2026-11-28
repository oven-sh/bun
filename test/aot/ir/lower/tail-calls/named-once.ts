// RUN: lower
// CHECK-LABEL: function {{*}}name="breakBehind"
// CHECK: [[breakCall]] = Call
// CHECK-NEXT: [[breakValue]] = CheckInitialized [[breakCall]]
// CHECK-NEXT: Return [[breakValue]]
// CHECK-LABEL: function {{*}}name="castsOnTheWay"
// CHECK: [[castCall]] = Call
// CHECK-NEXT: [[annotated]] = Convert [[castCall]] declared={type=undefined|null|number|string{{*}}}
// CHECK-NEXT: [[asserted]] = Convert [[annotated]] declared={type=number}
// CHECK-NEXT: Return [[asserted]]
// CHECK-LABEL: function {{*}}name="inOneStatement"
// CHECK: [[statementCall]] = Call
// CHECK-NEXT: Return [[statementCall]]
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
