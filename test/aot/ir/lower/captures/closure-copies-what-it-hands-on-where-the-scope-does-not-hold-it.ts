// RUN: lower
// CHECK-LABEL: function {{*}}name="outer"
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: function [[sum]] name="sum" {{*}}captures=[{type=env [[layout]] flags=[IsFromCompiler]}, {type={{*}}variableName="a"}, {type={{*}}variableName="b"}] thisType
// CHECK: function {{*}}kind=Arrow{{*}}captures=[{type=env [[layout]] flags=[IsFromCompiler]}, {type={{*}}variableName="a"}, {type={{*}}variableName="b"}, {type=number{{*}}variableName="i"}] thisType
// CHECK: b0([[scope]]: env [[layout]], [[a]]: {{*}}, [[b]]: {{*}}, [[i]]:
// CHECK-NOT: GetEnvironmentField
// CHECK: = CallDirect [[scope]], [[a]], [[b]], {{*}}function=[[sum]]

export function outer(k: number): (() => number)[] {
  const a = k;
  const b = k * 2;
  let calls = 0;
  return [0, 1].map(i => () => sum(i));
  function sum(i: number): number {
    calls++;
    return a + b + i + calls;
  }
}
