// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: b0([[a]]: number, [[b]]: number):
// CHECK: [[m]] = NewClosure [[a]] function=
// CHECK-NEXT: DefineMethod {{*}}, [[m]] {{*}}key="m"
// CHECK: [[n]] = NewClosure [[b]] function=
// CHECK-NEXT: DefineMethod {{*}}, [[n]] {{*}}key="n"
// CHECK: [[k]] = NewClosure function=
// CHECK-NEXT: DefineMethod {{*}}, [[k]] {{*}}key="k"
// CHECK-LABEL: function {{*}}name="m"
// CHECK: captures=[{type=number variableName="a"}] thisType
// CHECK: b0([[copyOfA]]: number):
// CHECK-LABEL: function {{*}}name="n"
// CHECK: captures=[{type=number variableName="b"}] thisType
// CHECK: b0([[copyOfB]]: number):
// CHECK-LABEL: function {{*}}name="k"
// CHECK-NOT: captures=
// CHECK: b0():

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: env L

// RUN(OWNER): lower
// OWNER-LABEL: function {{*}}name="f"
// OWNER-NOT: = NewObject
// OWNER-LABEL: function {{*}}kind=BaseConstructor

export function f(a: number, b: number) {
  return class {
    m() {
      return a;
    }
    n() {
      return b;
    }
    k() {}
  };
}

// A method has its body once reached code reads its name.
export function readsTheNames(o: any) { return [o.m]; }
