// RUN: lower
// CHECK-LABEL: function {{*}}name="count"
// CHECK: = Integer
// CHECK-NOT: illTypedCause=Assertion
// CHECK: = Call
// CHECK: = Convert {{*}}declared={type=0} illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="flag"
// CHECK-NOT: illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="word"
// CHECK-NOT: illTypedCause=Assertion

// `seen` is `false` to the checker until the assignment that it sees, whatever `visit` has done. Only a comparison rests on such a type, and it looks at the value.
// An integer is claimed all the same: the proof of an `int32` rests on its range.
enum Level {
  Low,
  High,
}

let seen = false;
let level: Level = Level.Low;
let name: "a" | "b" = "a";

function visit(): void {
  seen = true;
  level = Level.High;
  name = "b";
}

export function flag(): boolean {
  seen = false;
  visit();
  return !seen;
}

export function count(): number {
  level = Level.Low;
  visit();
  return level + 1;
}

export function word(): string {
  name = "a";
  visit();
  return name + "!";
}
