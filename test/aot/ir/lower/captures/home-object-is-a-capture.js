// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[head]] = NewObject
// CHECK: = NewClosure [[head]] function=
// CHECK: PropDefine [[head]], {{*}}key="m"
// CHECK-LABEL: function {{*}}name="withCopy"
// CHECK: b0([[p]]:
// CHECK: [[secondHead]] = NewObject
// CHECK: = NewClosure [[p]], [[secondHead]] function=
// CHECK-LABEL: function {{*}}name="m"
// CHECK: captures=[{type=object flags=[IsFromCompiler]}] thisType
// CHECK: b0([[home]]: object,
// CHECK: = GetSuperBase [[home]]
// CHECK-LABEL: function {{*}}name="n"
// CHECK: captures=[{type=anything}, {type=object flags=[IsFromCompiler]}] thisType
// CHECK: b0([[copy]]: anything, [[secondHome]]: object,
// CHECK: = GetSuperBase [[secondHome]]

export function f() {
  return {
    m() {
      return super.x;
    },
  };
}

export function withCopy(p) {
  return {
    n() {
      return super.x + p;
    },
  };
}
