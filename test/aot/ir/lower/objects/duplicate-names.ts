// RUN: lower
// CHECK-LABEL: function {{*}}name="create"
// CHECK: [[first]] = Call {{*}}calleeName="f"
// CHECK: = Integer integer=1
// CHECK: [[second]] = Call {{*}}calleeName="g"
// CHECK: [[head]] = NewObject -, [[first]], {{*}}fields=[0, 1]
// CHECK-NEXT: PropDefine [[head]], [[second]] key="a"
// CHECK-NEXT: = FinishObject [[head]]

declare function f(): unknown;
declare function g(): unknown;

export function create() {
  return {
    a: f(),
    b: 1,
    // @ts-expect-error
    a: g(),
  };
}
