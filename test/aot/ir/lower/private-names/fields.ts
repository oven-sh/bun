// RUN: lower
// CHECK-LABEL: function {{*}}name="get"
// CHECK: = PrivateGet [[getReceiver]], [[getToken]] layout=[[layout]] field=1 @
// CHECK-LABEL: function {{*}}name="set"
// CHECK: PrivateSet [[setReceiver]], [[setToken]], [[value]] layout=[[layout]] field=1 @
// CHECK-LABEL: function {{*}}kind=Initializer
// CHECK: PrivateDefine [[this]], [[token]], [[token]] layout=[[layout]] @
// CHECK: PrivateDefine [[this]], {{*}}layout=[[layout]] field=1 @

// RUN(KEYS): lower
// KEYS-NOT: key=#

export class C {
  #x = 1;
  get() {
    return this.#x;
  }
  set(v: number) {
    this.#x = v;
  }
}
