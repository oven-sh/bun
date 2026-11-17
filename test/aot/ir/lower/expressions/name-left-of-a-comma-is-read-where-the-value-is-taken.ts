// RUN: lower
// CHECK-LABEL: function {{*}}name="taken"
// CHECK: CheckInitialized {{*}}name="inner"

// RUN(DROPPED): lower
// DROPPED-LABEL: function {{*}}name="dropped"
// DROPPED-NOT: CheckInitialized
// DROPPED: Return

// RUN(TOP): lower
// TOP-LABEL: function {{*}}name="ofTheTopLevel"
// TOP-NOT: CheckInitialized
// TOP: Return

// `bun build` leaves the left of a comma out of a value that is taken only where it minifies. What it writes has no dead zone for a name of the top level.
export function taken(): number { // @ts-expect-error
  const first = (inner, 1);
  let inner = 2;
  return first + inner;
}

export function dropped(): number { // @ts-expect-error
  inner, 1;
  let inner = 2;
  return inner;
}

export function ofTheTopLevel(): number { // @ts-expect-error
  return (late, 1);
}
let late = 1;
