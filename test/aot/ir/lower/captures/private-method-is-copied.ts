// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[a]] = Call {{*}}calleeName="g"
// CHECK: [[token]] = NewClassToken
// CHECK: [[method]] = NewClosure [[a]] function=
// CHECK: = NewClosure [[token]], [[method]] function=
// CHECK-LABEL: function {{*}}name="#m"
// CHECK: captures=[{type=anything}] thisType
// CHECK-LABEL: function {{*}}name="n"
// CHECK: captures=[{type=classtoken flags=[IsFromCompiler]}, {type=anything}] thisType
// CHECK: b0([[tokenCopy]]: classtoken, [[methodCopy]]: anything, [[this]]:
// CHECK: = PrivateGet [[this]], [[tokenCopy]] layout=
// CHECK: = Call [[methodCopy]], [[this]]

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: env L

// RUN(OWNER): lower
// OWNER-LABEL: function {{*}}name="f"
// OWNER-NOT: = NewObject
// OWNER-LABEL: function {{*}}kind=BaseConstructor

declare function g(): unknown;

export function f() {
  const a = g();
  return class {
    #m() {
      return a;
    }
    n() {
      return this.#m();
    }
  };
}
