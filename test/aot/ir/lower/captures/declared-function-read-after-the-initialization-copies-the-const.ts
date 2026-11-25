// RUN: lower
// CHECK-NOT: EnvironmentField
// CHECK-LABEL: function {{*}}name="related"
// CHECK: Return
// CHECK: [[seen]] = Convert {{*}}Set<number>
// CHECK: [[visit]] = NewClosure [[seen]] function=
// CHECK: = Call {{*}}[[visit]] calleeName="walk"
// CHECK-LABEL: function {{*}}name="visit"
// CHECK: captures=[{type=anything variableName="seen"}] thisType

declare function walk(root: number, visit: (x: number) => boolean): boolean;

export function related(a: number, b: number): boolean {
  if (a === b) return true;
  const seen = new Set<number>([a, b]);
  return walk(a, visit);

  function visit(x: number): boolean {
    return seen.has(x);
  }
}
