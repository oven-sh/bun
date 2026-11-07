// RUN: lower
// CHECK-LABEL: function {{*}}name="related"
// CHECK: [[scope]] = NewObject layout=[[layout]]
// CHECK: [[visit]] = NewClosure [[scope]] function=
// CHECK: = Call {{*}}[[visit]] calleeName="keep"
// CHECK: PutEnvironmentField [[scope]], {{*}}layout=[[layout]]
// CHECK-LABEL: function {{*}}name="visit"
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}] thisType
// CHECK: = CheckInitialized {{*}}name="seen"

declare function keep(visit: (x: number) => boolean): void;

export function related(a: number, b: number): Set<number> {
  keep(visit);
  const seen = new Set<number>([a, b]);
  return seen;

  function visit(x: number): boolean {
    return seen.has(x);
  }
}
