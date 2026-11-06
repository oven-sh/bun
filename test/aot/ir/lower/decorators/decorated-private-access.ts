// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: = PrivateGet [[this]], {{*}}layout=[[layout]] @
// CHECK: = Call [[method]], [[this]]
// CHECK: = PrivateGet [[this]], {{*}}layout=[[layout]] field=
// CHECK: [[getter]] = PropGet [[pair]] key="get"
// CHECK: = Call [[getter]], [[this]]

// The lowering of a decorated `accessor` field defines its name with the value: a test asks for the name's own field.
// CHECK-LABEL: function {{*}}name="g"
// CHECK: = PrivateHas {{*}}layout=[[layout]] field=
// CHECK-LABEL: function {{*}}name="h"
// CHECK: = PrivateGet [[receiver]], {{*}}layout=[[layout]] field=
// CHECK: [[setter]] = PropGet [[setterPair]] key="set"
// CHECK: = Call [[setter]], [[receiver]]

declare const d: any;

export class C {
  @d #m() {}
  @d accessor #a = 1;
  f() {
    this.#m();
    return this.#a;
  }
  g(o: object) {
    return #a in o;
  }
  h() {
    this.#a = 2;
  }
}
