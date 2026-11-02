// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: = PrivateGet [[this]], {{*}}layout=[[layout]] @
// CHECK: = Call [[method]], [[this]]
// CHECK: = PrivateGet [[this]], {{*}}layout=[[layout]] field=
// CHECK: [[getter]] = PropGet [[pair]] key="get"
// CHECK: = Call [[getter]], [[this]]

declare const d: any;

export class C {
  @d #m() {}
  @d accessor #a = 1;
  f() {
    this.#m();
    return this.#a;
  }
}
