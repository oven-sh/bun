// RUN: lower
// CHECK-LABEL: function {{*}}name="holdsRegistry"
// CHECK: [[made]] = Construct {{*}}calleeName="FinalizationRegistry"
// CHECK-NEXT: [[registry]] = Convert [[made]] declared=
// CHECK: = NewClosure [[registry]] function=
// CHECK: = NewClosure [[registry]] function=

// RUN(OTHER): lower
// OTHER-LABEL: function {{*}}name="holdsNothingElse"
// OTHER: = NewClosure [[list]] function=
// OTHER: = NewClosure function=

// RUN(OBJECT): lower
// OBJECT-LABEL: function {{*}}name="holdsNameThatEveryObjectFits"
// OBJECT: = NewClosure [[registry]] function=
// OBJECT: = NewClosure [[registry]] function=

// RUN(WEAK): lower
// WEAK-LABEL: function {{*}}name="holdsNameOfTypeThatRequiresLittle"
// WEAK: = NewClosure [[registry]] function=
// WEAK: = NewClosure [[registry]] function=

// RUN(ARGUMENT): lower
// ARGUMENT-LABEL: function {{*}}name="holdsWhatCallInSightPasses"
// ARGUMENT: = NewClosure [[registry]] function=
// ARGUMENT: = NewClosure [[registry]] function=

// RUN(LIST): lower
// LIST-LABEL: function {{*}}name="holdsNoListThatCallInSightPasses"
// LIST: = NewClosure [[list]] function=
// LIST: = NewClosure function=

declare function hand(value: unknown): void;

export function holdsRegistry(note: (held: string) => void) {
  const registry = new FinalizationRegistry(note);
  return [(target: object) => registry.register(target, ""), () => 1];
}

export function holdsNothingElse(list: string[]) {
  return [() => list, () => 1];
}

export function holdsNameThatEveryObjectFits(note: (held: string) => void) {
  const registry: object = new FinalizationRegistry(note);
  return [() => hand(registry), () => 1];
}

export function holdsNameOfTypeThatRequiresLittle(note: (held: string) => void) {
  const registry: { toString(): string } = new FinalizationRegistry(note);
  return [() => hand(registry), () => 1];
}

function holdsWhatCallInSightPasses(registry: any) {
  return [() => hand(registry), () => 1];
}

function holdsNoListThatCallInSightPasses(list: any) {
  return [() => hand(list), () => 1];
}

export function passes(note: (held: string) => void, list: string[]) {
  return [holdsWhatCallInSightPasses(new FinalizationRegistry(note)), holdsNoListThatCallInSightPasses(list)];
}
