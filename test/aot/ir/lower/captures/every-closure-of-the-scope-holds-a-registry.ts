// RUN: lower
// CHECK-LABEL: function {{*}}name="holdsNothingElse"
// CHECK: = NewClosure [[list]] function=
// CHECK: = NewClosure function=
// CHECK-LABEL: function {{*}}name="holdsRegistry"
// CHECK: = Construct {{*}}calleeName="FinalizationRegistry"
// CHECK: = NewClosure [[registry]] function=
// CHECK: = NewClosure [[registry]] function=

export function holdsRegistry(note: (held: string) => void) {
  const registry = new FinalizationRegistry(note);
  return [(target: object) => registry.register(target, ""), () => 1];
}

export function holdsNothingElse(list: string[]) {
  return [() => list, () => 1];
}
