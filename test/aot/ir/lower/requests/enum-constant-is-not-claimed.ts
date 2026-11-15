// RUN: lower
// CHECK-LABEL: function {{*}}name="pick"
// CHECK: = Integer
// CHECK-NOT: illTypedCause=Assertion
// CHECK: Return
// CHECK-LABEL: function {{*}}name="word"
// CHECK: = String string="b"
// CHECK-NOT: illTypedCause=Assertion
// CHECK: Return

// A member of an enum whose value the build knows is that constant, and a constant has its own type: nothing is claimed of it.
enum Kind {
  First = 1,
  Second = 2,
}

enum Word {
  First = "a",
  Second = "b",
}

export function pick(): Kind {
  return Kind.Second;
}

export function word(): Word {
  return Word.Second;
}
