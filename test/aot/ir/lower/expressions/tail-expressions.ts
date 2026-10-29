// RUN: lower
// CHECK-LABEL: function {{*}}name="awaited"
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="cast"
// CHECK: [[castCall]] = Call
// CHECK-NEXT: ReturnCall [[castCall]] casts=[{declared={type=undefined|null|number|string site=w{{*}}}}, {declared={type=number site=w{{*}}}}
// CHECK-LABEL: function {{*}}name="comma"
// CHECK: = Call {{*}}calleeName="h"
// CHECK-NOT: ReturnCall
// CHECK: [[commaCall]] = Call {{*}}calleeName="f"
// CHECK-NEXT: ReturnCall [[commaCall]]
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK: [[yesCall]] = Call {{*}}calleeName="f"
// CHECK-NEXT: ReturnCall [[yesCall]]
// CHECK-LABEL: function {{*}}name="element"
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="logical"
// CHECK: [[logicalCall]] = Call {{*}}calleeName="f"
// CHECK-NEXT: ReturnCall [[logicalCall]]
// CHECK-LABEL: function {{*}}name="member"
// CHECK: [[memberCall]] = Call {{*}}calleeKey="m"
// CHECK-NEXT: ReturnCall [[memberCall]]
// CHECK-LABEL: function {{*}}name="operand"
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="plain"
// CHECK: [[plainCall]] = Call {{*}}calleeName="f"
// CHECK-NEXT: ReturnCall [[plainCall]]
// CHECK-LABEL: function {{*}}name="tagged"
// CHECK: [[taggedCall]] = Call {{*}}calleeName="tag"
// CHECK-NEXT: ReturnCall [[taggedCall]]

// RUN(NO): lower
// NO-LABEL: function {{*}}name="conditional"
// NO: [[noCall]] = Call {{*}}calleeName="g"
// NO-NEXT: ReturnCall [[noCall]]

export async function awaited(f: any) {
  return await f();
}

export function cast(f: () => string | number) {
  return f() as number;
}

export function comma(f: any, h: any) {
  return (h(), f());
}

export function conditional(c: any, f: any, g: any) {
  return c ? f() : g();
}

export function element(f: any) {
  return [f()];
}

export function logical(a: any, f: any) {
  return a && f();
}

export function member(o: any, x: any) {
  return o.m(x);
}

export function operand(f: any) {
  return f() + 1;
}

export function plain(f: any, x: any) {
  return f(x);
}

export function tagged(tag: any) {
  return tag`t`;
}
