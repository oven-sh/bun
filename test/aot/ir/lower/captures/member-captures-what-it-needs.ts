// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[a]] = Convert {{*}}declared={type=1 site=[[siteOfA]]}
// CHECK: [[b]] = Convert {{*}}declared={type=2 site=[[siteOfB]]}
// CHECK: [[m]] = NewClosure [[a]] function=
// CHECK-NEXT: DefineMethod {{*}}, [[m]] {{*}}key="m"
// CHECK: [[n]] = NewClosure [[b]] function=
// CHECK-NEXT: DefineMethod {{*}}, [[n]] {{*}}key="n"
// CHECK: [[k]] = NewClosure function=
// CHECK-NEXT: DefineMethod {{*}}, [[k]] {{*}}key="k"
// CHECK-LABEL: function {{*}}name="m"
// CHECK: captures=[{type=1 site=[[siteOfA]]}] thisType
// CHECK: b0([[copyOfA]]: 1):
// CHECK-LABEL: function {{*}}name="n"
// CHECK: captures=[{type=2 site=[[siteOfB]]}] thisType
// CHECK: b0([[copyOfB]]: 2):
// CHECK-LABEL: function {{*}}name="k"
// CHECK-NOT: captures=
// CHECK: b0():

// RUN(ENVIRONMENTS): lower
// ENVIRONMENTS-NOT: env L

// RUN(OWNER): lower
// OWNER-LABEL: function {{*}}name="f"
// OWNER-NOT: = NewObject
// OWNER-LABEL: function {{*}}kind=BaseConstructor

export function f() {
  const a = 1,
    b = 2;
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
