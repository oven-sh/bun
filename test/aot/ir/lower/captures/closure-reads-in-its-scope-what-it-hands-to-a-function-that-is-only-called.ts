// RUN: lower
// CHECK-LABEL: function {{*}}name="outer"
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: function [[sum]] name="sum" {{*}}captures=[{type=env [[layout]] flags=[IsFromCompiler]}, {type={{*}}variableName="a"}, {type={{*}}variableName="b"}] thisType
// CHECK: function {{*}}kind=Arrow{{*}}captures=[{type=env [[layout]] flags=[IsFromCompiler]}, {type=number{{*}}variableName="i"}] thisType
// CHECK: b0([[scope]]: env [[layout]], [[i]]:
// CHECK: = GetEnvironmentField [[scope]] layout=[[layout]]
// CHECK: = GetEnvironmentField [[scope]] layout=[[layout]] field=1
// CHECK: = CallDirect [[scope]], {{*}}function=[[sum]]

export function outer(k: number): unknown[] {
  const early = peek;
  const a = k;
  const b = k * 2;
  let calls = 0;
  return [early, [0, 1].map(i => () => sum(i))];
  function peek(): number {
    return a + b;
  }
  function sum(i: number): number {
    calls++;
    return a + b + i + calls;
  }
}
