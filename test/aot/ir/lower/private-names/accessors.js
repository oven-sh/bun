// RUN: lower
// CHECK-LABEL: function {{*}}name="readA"
// CHECK: = PrivateGet [[readReceiver]], [[readToken]] layout=[[layout]] @
// CHECK: = Call [[getter]], [[readReceiver]] @
// CHECK-LABEL: function {{*}}name="writeA"
// CHECK: = PrivateGet {{*}}layout=[[layout]] @
// CHECK: = NewRuntimeError runtimeError=PrivateAccessorWithoutSetter
// CHECK-LABEL: function {{*}}name="readB"
// CHECK: = PrivateGet {{*}}layout=[[layout]] @
// CHECK: = NewRuntimeError runtimeError=PrivateAccessorWithoutGetter
// CHECK-LABEL: function {{*}}name="writeB"
// CHECK: = PrivateGet [[writeReceiver]], [[writeToken]] layout=[[layout]] @
// CHECK: = Call [[setter]], [[writeReceiver]], [[value]] @

// RUN(PIECES): lower
// PIECES-COUNT-4: DefineMethod
// PIECES-NOT: DefineMethod

export class C {
  get #a() {
    return 1;
  }
  set #b(v) {}
  readA() {
    return this.#a;
  }
  writeA() {
    this.#a = 1;
  }
  readB() {
    return this.#b;
  }
  writeB() {
    this.#b = 1;
  }
}
