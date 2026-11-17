// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: NewClosure
// CHECK: [[token]] = NewClassToken
// CHECK: [[constructor]] = NewClosure [[token]] function=
// CHECK: = NewClass [[constructor]]
// CHECK: = NewClosure [[token]] function=
// CHECK-LABEL: function {{*}}name="r"
// CHECK: captures=[{type=classtoken flags=[IsFromCompiler]}] thisType

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: env L

// RUN(OWNER): lower
// OWNER-LABEL: function {{*}}name="f"
// OWNER-NOT: = NewObject
// OWNER-LABEL: function {{*}}kind=BaseConstructor

export function f() {
  return class {
    #p = 1;
    r() {
      return this.#p;
    }
  };
}
