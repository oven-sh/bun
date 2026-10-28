// RUN: lower
// CHECK-LABEL: function {{*}}name="define"
// CHECK: [[head]] = NewClass [[constructor]]
// CHECK: [[value]] = Call {{*}}calleeName="k"
// CHECK: = ToPropertyKey [[value]]
// CHECK: = FinishClass [[head]]

// RUN(CONVERSIONS): lower
// CONVERSIONS-COUNT-1: = ToPropertyKey
// CONVERSIONS-NOT: = ToPropertyKey

// RUN(INITIALIZER): lower
// INITIALIZER-LABEL: function {{*}}kind=Initializer
// INITIALIZER-NOT: = Call
// INITIALIZER: ElemDefine [[this]],
// INITIALIZER: PropDefine [[this]], {{*}}key="ab"
// INITIALIZER: PropDefine [[this]], {{*}}key=@@iterator

export function define(k) {
  return class {
    [k()] = 1;
    ["a" + "b"] = 2;
    [Symbol.iterator] = 3;
  };
}
