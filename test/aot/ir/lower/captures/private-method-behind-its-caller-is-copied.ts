// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[token]] = NewClassToken
// CHECK: [[method]] = NewClosure function=
// CHECK: = NewClosure [[token]], [[method]] function=
// CHECK-LABEL: function {{*}}name="n"
// CHECK: captures=[{type=classtoken flags=[IsFromCompiler]}, {type=anything}] thisType
// CHECK: b0([[tokenCopy]]: classtoken, [[methodCopy]]: anything, [[this]]:
// CHECK: = Call [[methodCopy]], [[this]]

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: env L

export function f() {
  return class {
    n() {
      return this.#m();
    }
    #m() {}
  };
}
