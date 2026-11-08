// RUN: lower
// CHECK-LABEL: function {{*}}name="outer"
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: function {{*}}name="walk" {{*}}captures=[{type=env [[layout]] flags=[IsFromCompiler]}] thisType
// CHECK: function {{*}}kind=Arrow{{*}}captures=[{type=env [[layout]] flags=[IsFromCompiler]}] thisType
// CHECK: = GetEnvironmentField {{*}}layout=[[layout]]

export function outer(run: (f: () => () => number) => () => number): number {
  let x = 1;
  const early = run(a);
  x = 2;
  return early();
  function a() {
    return walk();
  }
  function walk() {
    return () => x;
  }
}
