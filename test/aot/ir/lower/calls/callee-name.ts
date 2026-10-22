// RUN: lower
// CHECK-LABEL: function {{*}}name="callResult"
// CHECK: [[inner]] = Call {{*}}calleeName="f"
// CHECK-NEXT: [[convertedInner]] = Convert [[inner]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[convertedInner]]
// CHECK-NOT: calleeName
// CHECK-LABEL: function {{*}}name="computed"
// CHECK-NOT: calleeName
// CHECK: = Call
// CHECK-NOT: calleeName
// CHECK-LABEL: function {{*}}name="construct"
// CHECK: = Construct {{*}}calleeName="C"
// CHECK-LABEL: function {{*}}name="constructMember"
// CHECK: = Construct {{*}}calleeName="C"
// CHECK-LABEL: function {{*}}name="identifier"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="member"
// CHECK: = Call {{*}}calleeName="m"
// CHECK-LABEL: function {{*}}name="nested"
// CHECK: = Call {{*}}calleeName="b"
// CHECK-LABEL: function {{*}}name="optionalCall"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="optionalMember"
// CHECK: = Call {{*}}calleeName="m"
// CHECK-LABEL: function {{*}}name="superMember"
// CHECK: = Call {{*}}calleeName="m"

export function callResult(f: any) {
  f()();
}

export function computed(o: any, k: any) {
  o[k]();
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

export function nested(o: any) {
  o.a.b();
}

export function optionalCall(f: any) {
  f?.();
}

export function optionalMember(o: any) {
  o?.m();
}

class Base {
  m() {}
}

export class Derived extends Base {
  superMember() {
    super.m();
  }
}
