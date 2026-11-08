// RUN: lower
// CHECK-LABEL: function {{*}}name="bits"
// CHECK: ({{*}}, [[masked]]: number):
// CHECK: = BitAnd [[masked]],
// CHECK-LABEL: function {{*}}name="fromLength"
// CHECK: ({{*}}, [[down]]: number):
// CHECK: = ElemGet {{*}}, [[down]]
// CHECK: = Decrement [[down]]
// CHECK-LABEL: function {{*}}name="index"
// CHECK: ({{*}}, [[counter]]: number):
// CHECK: = Less [[counter]],
// CHECK: = ElemGet {{*}}, [[counter]]
// CHECK: = Increment [[counter]]
// CHECK-LABEL: function {{*}}name="written"
// CHECK: ({{*}}, [[annotated]]: number):
// CHECK: = Increment [[annotated]]

// RUN(NOWHERE): lower
// NOWHERE-NOT: i32

// In a checked file a counter is stored to again, so it has the type that the checker gives it, with an annotation or without: a number. A read of it is converted to nothing: whether it stays an int32 is for the engine to find out.

export function bits(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i & 7;
  return sum;
}

export function fromLength(list: number[]): number {
  let sum = 0;
  for (let i = list.length - 1; i >= 0; i--) sum += list[i];
  return sum;
}

export function index(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

export function written(list: number[]): number {
  let sum = 0;
  for (let i: number = 0; i < list.length; i++) sum += list[i];
  return sum;
}
