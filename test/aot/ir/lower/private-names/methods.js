// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[head]] = NewClass [[constructor]]
// CHECK: = NewClosure function=[[method]]
// CHECK-NOT: function=[[method]]
// CHECK: = FinishClass [[head]]
// CHECK-NOT: function=[[method]]
// CHECK: function [[method]] name="#m"
// CHECK-NOT: function=[[method]]

// RUN(PIECES): lower
// PIECES-COUNT-3: DefineMethod
// PIECES-NOT: DefineMethod

// RUN(ACCESSES): lower
// ACCESSES-LABEL: function {{*}}name="a"
// ACCESSES: = PrivateGet [[readReceiver]], [[readToken]] layout=[[layout]] @
// ACCESSES-NOT: NewClosure
// ACCESSES-LABEL: function {{*}}name="b"
// ACCESSES: = PrivateGet [[callReceiver]], [[callToken]] layout=[[layout]] @
// ACCESSES: = Call [[callee]], [[callReceiver]], {{*}}calleeName="this.#m"
// ACCESSES-LABEL: function {{*}}name="c"
// ACCESSES: = PrivateGet [[writeReceiver]], [[writeToken]] layout=[[layout]] @
// ACCESSES: = NewRuntimeError runtimeError=PrivateMethodWrite

export class C {
  #m() {}
  a() {
    return this.#m;
  }
  b() {
    this.#m(1);
  }
  c() {
    this.#m = 1;
  }
}
