// RUN: lower
// CHECK-LABEL: function {{*}}name="captured"
// CHECK: [[capturedTest]] = TypeTest {{*}}testedType=string @
// CHECK-NEXT: Branch [[capturedTest]] -> taken [[capturedTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[capturedTaken]]([[unusedField]]):
// CHECK-NOT: [[unusedField]]
// CHECK: = GetEnvironmentField
// CHECK-NOT: [[unusedField]]
// CHECK-LABEL: function {{*}}name="local"
// CHECK: [[localTest]] = TypeTest [[value]] testedType=string @
// CHECK-NEXT: Branch [[localTest]] -> taken [[localTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[localTaken]]([[text]]):
// CHECK-NEXT: [[named]] = NarrowByTest [[value]], [[text]]
// CHECK: = PropGet [[named]] key="length"
// CHECK-LABEL: function {{*}}name="moduleLevel"
// CHECK: [[moduleTest]] = TypeTest {{*}}testedType=string @
// CHECK-NEXT: Branch [[moduleTest]] -> taken [[moduleTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[moduleTaken]]([[unusedVariable]]):
// CHECK-NOT: [[unusedVariable]]
// CHECK: = GetModuleVariable
// CHECK-NOT: [[unusedVariable]]
// CHECK-LABEL: function {{*}}name="store"

declare function g(): unknown;

let shared: unknown = g();

export function captured() {
  let x = g();
  const h = () => {
    x = g();
  };
  if (typeof x === "string") return x.length;
  return h;
}

export function local() {
  const x = g();
  if (typeof x === "string") return x.length;
  return 0;
}

export function moduleLevel() {
  if (typeof shared === "string") return shared.length;
  return 0;
}

export function store(value: unknown) {
  shared = value;
}
