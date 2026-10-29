// A call says what the program calls its callee, for "a.b.c is not a function": the callee as it is written where it consists of names, `this`, `super` and names in brackets. Of anything else that ends in a name, the name.
// RUN: lower
// CHECK-LABEL: function {{*}}name="callResult"
// CHECK: [[inner]] = Call {{*}}calleeName="f"
// CHECK-NEXT: [[convertedInner]] = Convert [[inner]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[convertedInner]]
// CHECK-NOT: calleeName
// CHECK-LABEL: function {{*}}name="cast"
// CHECK: = Call {{*}}calleeName="o.a.m"
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: = Call {{*}}calleeName="o[k]"
// CHECK-LABEL: function {{*}}name="computedByExpression"
// CHECK-NOT: calleeName
// CHECK: = Call
// CHECK-NOT: calleeName
// CHECK-LABEL: function {{*}}name="construct"
// CHECK: = Construct {{*}}calleeName="C"
// CHECK-LABEL: function {{*}}name="constructMember"
// CHECK: = Construct {{*}}calleeName="ns.C"
// CHECK-LABEL: function {{*}}name="identifier"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="member"
// CHECK: = Call {{*}}calleeName="o.m"
// CHECK-LABEL: function {{*}}name="memberOfCallResult"
// CHECK: = Call {{*}}calleeName="f"
// CHECK: = Call {{*}}calleeName="m"
// CHECK-LABEL: function {{*}}name="nested"
// CHECK: = Call {{*}}calleeName="o.a.b"
// CHECK-LABEL: function {{*}}name="optionalCall"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="optionalComputed"
// CHECK: = Call {{*}}calleeName="o?.[k].m"
// CHECK-LABEL: function {{*}}name="optionalMember"
// CHECK: = Call {{*}}calleeName="o?.m"
// CHECK-LABEL: function {{*}}name="optionalThenMember"
// CHECK: = Call {{*}}calleeName="o?.a.m"
// CHECK-LABEL: function {{*}}name="tooLong"
// CHECK: = Call {{*}}calleeName="m"
// CHECK-LABEL: function {{*}}name="privateMember"
// CHECK: = Call {{*}}calleeName="this.#hidden"
// CHECK-LABEL: function {{*}}name="superMember"
// CHECK: = Call {{*}}calleeName="super.m"
// CHECK-LABEL: function {{*}}name="thisMember"
// CHECK: = Call {{*}}calleeName="this.inner.m"

export function callResult(f: any) {
  f()();
}

export function cast(o: any) {
  ((o as any).a!).m();
}

export function computed(o: any, k: any) {
  o[k]();
}

export function computedByExpression(o: any, k: any) {
  o[k + 1]();
}

export function construct(C: any) {
  new C();
}

export function constructMember(ns: any) {
  new ns.C();
}

export function identifier(f: any) {
  f();
}

export function member(o: any) {
  o.m();
}

export function memberOfCallResult(f: any) {
  f().m();
}

export function nested(o: any) {
  o.a.b();
}

export function optionalCall(f: any) {
  f?.();
}

export function optionalComputed(o: any, k: any) {
  o?.[k].m();
}

export function optionalMember(o: any) {
  o?.m();
}

export function optionalThenMember(o: any) {
  o?.a.m();
}

export function tooLong(o: any) {
  o.aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccc.dddddddddddddddddddd.m();
}

class Base {
  m() {}
}

export class Derived extends Base {
  inner: any;
  #hidden() {}
  privateMember() {
    this.#hidden();
  }
  superMember() {
    super.m();
  }
  thisMember() {
    this.inner.m();
  }
}
