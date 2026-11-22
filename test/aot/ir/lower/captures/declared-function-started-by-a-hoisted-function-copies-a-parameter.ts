// RUN: lower
// CHECK: function {{*}}name="walk" {{*}}captures=[{type=number variableName="p"}] thisType
// CHECK: function {{*}}kind=Arrow{{*}}captures=[{type=number variableName="p"}] thisType

export function outer(run: (f: () => () => number) => () => number, p: number): number {
  const early = run(a);
  return early();
  function a() {
    return walk();
  }
  function walk() {
    return () => p;
  }
}
