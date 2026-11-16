// RUN: lower
// CHECK-LABEL: function {{*}}name="count"
// CHECK-NOT: illTypedCause=Assertion
// CHECK: = Call
// CHECK: [[level]] = CheckInitialized {{*}}name="level"
// CHECK-NEXT: [[one]] = Integer integer=1
// CHECK-NEXT: = Add [[level]], [[one]]
// CHECK-NOT: illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="flag"
// CHECK-NOT: illTypedCause=Assertion
// CHECK: = Call
// CHECK: [[seen]] = CheckInitialized {{*}}name="seen"
// CHECK-NEXT: = ToBoolean [[seen]]
// CHECK-NOT: illTypedCause=Assertion
// CHECK-LABEL: function {{*}}name="word"
// CHECK-NOT: illTypedCause=Assertion
// CHECK: = Call
// CHECK: [[name]] = CheckInitialized {{*}}name="name"
// CHECK-NEXT: [[mark]] = String string="!"
// CHECK-NEXT: = Add [[name]], [[mark]]
// CHECK-NOT: illTypedCause=Assertion

// `seen` is `false` to the checker until the assignment that it sees, whatever `visit` has done. Nothing of that is sent: the read behind the call is used as it is,
// a boolean, an integer and a string alike.
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
