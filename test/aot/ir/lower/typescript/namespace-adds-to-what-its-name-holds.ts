// RUN: lower
// `Box || (Box = {})`: code stores to the name, so the one declaration looks at what the name holds.
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[stored]] = Data
// CHECK: [[test]] = ToBoolean [[stored]]
// CHECK: Branch [[test]] -> taken [[held]]({{*}}), notTaken [[missing]](
// CHECK: [[missing]](
// CHECK: = NewObject
// CHECK: PropSet {{*}}key="depth"

// @ts-ignore
Box = { size: "early" };
namespace Box {
  export var depth = 1;
}
console.log(Box);
export {};
