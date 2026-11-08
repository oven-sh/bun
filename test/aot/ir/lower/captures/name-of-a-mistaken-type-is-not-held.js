// RUN: lower
// CHECK-LABEL: function {{*}}name="holdsNoMemberThatNothingDeclares"
// CHECK: = NewClosure [[extra]] function=
// CHECK: = NewClosure function=

// RUN(LITERAL): lower
// LITERAL-LABEL: function {{*}}name="holdsNoLiteralThatEveryObjectFits"
// LITERAL: = NewClosure [[literal]] function=
// LITERAL: = NewClosure function=

// The checker has no type for `known.extra`. That says as little as `any`, and is no reason for every closure of the scope to hold the name as it holds a FinalizationRegistry.
class Known {}

export function makesRegistry(note) {
  return new FinalizationRegistry(note);
}

export function holdsNoMemberThatNothingDeclares(known = new Known()) {
  const extra = known.extra;
  return [() => extra, () => 1];
}

// A FinalizationRegistry fits `{ toString(): string }`, and so does every other object.
export function holdsNoLiteralThatEveryObjectFits() {
  const literal = { toString: () => "text" };
  return [() => literal, () => 1];
}
