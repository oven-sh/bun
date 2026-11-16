// RUN: link
// CHECK: layout {{*}}fields=[{key="both"{{*}}supertypes=[
// CHECK-NOT: ,
// CHECK: [[one]], [[other]]]

// Whichever `kind` an Either has, it fits First or Second, so the union takes it, and neither of the two does alone. It goes below both.
interface Either {
  both: number;
  kind: "a" | "b";
}

interface First {
  first?: number;
  kind: "a";
}

interface Second {
  kind: "b";
  second?: number;
}

export function widen(either: Either) {
  return either as First | Second;
}
