// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[isClass]] = StrictEq [[object]], [[class]]
// CHECK-NEXT: Branch [[isClass]] -> taken [[admitted]](), notTaken [[rejected]]()
// CHECK: [[admitted]]():
// CHECK-NEXT: = GetModuleVariable
// CHECK: [[rejected]]() frequency=Unlikely:
// CHECK-NEXT: = NewRuntimeError runtimeError=InvalidPrivateRead

// RUN(METHOD): lower
// METHOD-LABEL: function {{*}}name="f"
// METHOD-COUNT-2: = StrictEq
// METHOD: = Call {{*}}calleeName="o.#m"
// METHOD: frequency=Unlikely:
// METHOD-NEXT: = NewRuntimeError runtimeError=InvalidPrivateBrand

// RUN(INSTANCE): lower
// INSTANCE-NOT: NewClassToken
// INSTANCE-NOT: PrivateGet

export class C {
  static #x = 1;
  static #m() {
    return 2;
  }
  static f(o: typeof C) {
    return o.#x + o.#m();
  }
}
