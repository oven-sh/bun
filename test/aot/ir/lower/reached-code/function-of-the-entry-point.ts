// RUN: link
// CHECK-LABEL: function {{*}}name="exported"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="called"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="neverNamed"
// CHECK-NOT: Return
// CHECK: [[errorOfNeverNamed]] = NewRuntimeError runtimeError=LeftOutOfExecutable
// CHECK-NEXT: Throw [[errorOfNeverNamed]]

// RUN(ALSO): link
// ALSO-LABEL: function {{*}}name="namedOnlyThere"
// ALSO-NOT: Return
// ALSO: NewRuntimeError runtimeError=LeftOutOfExecutable
// ALSO-LABEL: function {{*}}name="namesItself"
// ALSO-NOT: Return
// ALSO: NewRuntimeError runtimeError=LeftOutOfExecutable

// What an entry point exports is in the program. A reference from a function that is itself left out does not count, nor does a function's
// reference to itself: such a function has no body either.
export function exported(): number {
  return 1;
}

function called(): number {
  return 2;
}

function neverNamed(): number {
  return namedOnlyThere();
}

function namedOnlyThere(): number {
  return 3;
}

function namesItself(depth: number): number {
  return depth === 0 ? 0 : namesItself(depth - 1);
}

console.log(called());
