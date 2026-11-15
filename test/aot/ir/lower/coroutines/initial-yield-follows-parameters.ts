// RUN: lower
// CHECK-LABEL: function {{*}}name="generate"{{*}}IsGenerator{{*}}TakesCallee
// CHECK: = Call
// CHECK: InitialYield
// CHECK-NOT: InitialYield
// CHECK: = Yield
// CHECK-NOT: InitialYield
// CHECK-LABEL: function {{*}}name="generateLater"{{*}}IsAsync, IsGenerator{{*}}TakesCallee
// CHECK: = Call
// CHECK: InitialYield
// CHECK-NOT: InitialYield
// CHECK: = Yield
// CHECK-NOT: InitialYield
// CHECK-LABEL: function {{*}}name="wait"{{*}}IsAsync
// CHECK-NOT: InitialYield

// RUN(CALLEE): lower
// CALLEE-NOT: name="wait"{{*}}TakesCallee
// CALLEE-NOT: name="wait"{{*}}IsGenerator

declare function first(): number;

export function* generate(value: number = first()) {
  yield value;
}

export async function* generateLater(value: number = first()) {
  yield value;
}

export async function wait(value: number = first()) {
  await value;
}
