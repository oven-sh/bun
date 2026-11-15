// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: SetFunctionName
// CHECK-NOT: ElemDefine

// RUN(NAMED): lower
// NAMED: function {{*}}name="held/key" {{*}}IsNamedByComputedKey
// NAMED: function {{*}}name="held/key/joined" {{*}}IsNamedByComputedKey

// The key of a definition that a constant variable holds is known when the program is compiled: the text stands in the header of the function, marked IsNamedByComputedKey, and names the frames of a stack; nothing names the function at run time, and the property is laid under a constant key.
const held = "held/key";

export const o = {
  [held]() {},
  [`${held}/joined`]() {},
};
